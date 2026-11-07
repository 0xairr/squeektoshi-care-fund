// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {HookMiner} from "v4-periphery/test/shared/HookMiner.sol";
import {LiquidityAmounts} from "v4-periphery/src/libraries/LiquidityAmounts.sol";
import {CareToken} from "../src/CareToken.sol";
import {CareVault} from "../src/CareVault.sol";
import {CareHook} from "../src/CareHook.sol";
import {BuybackBurner} from "../src/BuybackBurner.sol";
import {CareBallot, ICareVaultAllowance} from "../src/CareBallot.sol";
import {CareAirdrop} from "../src/CareAirdrop.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";

interface IPermit2Approve {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface IPositionManagerMin {
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
    function nextTokenId() external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function getPositionLiquidity(uint256 tokenId) external view returns (uint128);
}

/// @notice Deploys the whole fund in one run and launches it:
///
///   1. CareToken - the whole supply, minted to this run's sender;
///   2. CareVault - one month of care, keeper and rescue fixed;
///   3. CareHook  - at a mined CREATE2 address (it deploys its BuybackBurner itself);
///   4. the ETH/CARE pool, initialised at the launch price;
///   5. one liquidity position holding the entire supply, single-sided (no ETH needed), minted
///      straight to the dead address so it can never be removed. Any rounding dust is burned too,
///      so the deployer ends with no tokens and no position.
///
/// Environment:
///
///   KEEPER                  who receives the weekly allowance                (required)
///   RESCUE                  who receives what is left at the end             (required)
///   MONTHLY_ALLOWANCE_USD   whole dollars; the vault holds one month of this (default 1000)
///   TOKEN_NAME / TOKEN_SYMBOL / TOKEN_SUPPLY                                 (defaults below)
///   LAUNCH_FDV_WEI          what the whole supply is worth at launch, in wei (default 1 ether)
///   POOL_MANAGER / POSITION_MANAGER / PERMIT2 / ETH_USD_FEED                 (default: Sepolia)
///   LP_FEE                  pool's own LP fee in hundredths of a bip         (default 0)
///   TICK_SPACING                                                             (default 60)
///   BURN_MIN_ETH            ETH that has to pile up before a buyback runs    (default 0.005 ether)
///   BURN_MAX_SLIPPAGE_BPS   worst fill a buyback may accept, below spot      (default 300 = 3%)
///
///   forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --private-key $PRIVATE_KEY
contract Deploy is Script {
    // Sepolia
    address constant SEPOLIA_POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant SEPOLIA_POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
    address constant SEPOLIA_ETH_USD_FEED = 0x694AA1769357215DE4FAC081bf1f309aDC325306;
    address constant PERMIT2_DEFAULT = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    address constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    uint256 constant DEFAULT_SUPPLY = 1_000_000_000e18;

    /// @dev The canonical deterministic CREATE2 deployer (live on Sepolia and mainnet). Mining the
    ///      hook salt against it, and deploying through it, puts the hook on the same address no
    ///      matter which account runs the script.
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    // v4-periphery Actions
    uint8 constant MINT_POSITION = 0x02;
    uint8 constant SETTLE_PAIR = 0x0d;

    struct Params {
        address keeper;
        address rescue;
        uint256 monthlyUsd;
        string name;
        string symbol;
        uint256 supply;
        uint256 launchFdvWei;
        address poolManager;
        address positionManager;
        address permit2;
        address feed;
        uint24 lpFee;
        int24 tickSpacing;
        uint256 minBurnEth;
        uint256 maxBurnSlippageBps;
        bytes32 airdropRoot;
        uint256 airdropSnapshotBlock;
        uint256 airdropBps;
        uint256 airdropDays;
    }

    CareToken public token;
    CareVault public vault;
    CareBallot public ballot;
    CareAirdrop public airdrop;
    CareHook public hook;
    PoolKey internal _poolKey;
    uint256 public lpTokenId;
    int24 public launchTick;

    function run() external {
        Params memory p = _params();
        uint256 startBlock = block.number;
        vm.startBroadcast();
        _deploy(p, msg.sender);
        vm.stopBroadcast();
        _log(p);
        _record(p, startBlock);
    }

    /// @dev Writes the addresses for `node script/wire.mjs`, which copies them into the site config.
    ///      Only a real run writes it; the fork rehearsal leaves the file alone.
    function _record(Params memory p, uint256 startBlock) internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployBlock", startBlock);
        vm.serializeAddress(k, "token", address(token));
        vm.serializeAddress(k, "vault", address(vault));
        vm.serializeAddress(k, "hook", address(hook));
        vm.serializeAddress(k, "burner", address(hook.burner()));
        vm.serializeAddress(k, "ballot", address(ballot));
        vm.serializeAddress(k, "airdrop", address(airdrop));
        vm.serializeUint(k, "airdropSnapshotBlock", p.airdropSnapshotBlock);
        vm.serializeAddress(k, "keeper", p.keeper);
        vm.serializeAddress(k, "rescue", p.rescue);
        vm.serializeUint(k, "lpTokenId", lpTokenId);
        vm.serializeUint(k, "poolFee", uint256(p.lpFee));
        string memory json = vm.serializeInt(k, "tickSpacing", int256(p.tickSpacing));
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), ".json"));
    }

    /// @notice The same deployment without a broadcast, for the fork rehearsal.
    function rehearse() external {
        Params memory p = _params();
        _deploy(p, address(this));
    }

    function _params() internal view returns (Params memory p) {
        p.keeper = vm.envAddress("KEEPER");
        p.rescue = vm.envAddress("RESCUE");
        p.monthlyUsd = vm.envOr("MONTHLY_ALLOWANCE_USD", uint256(1000));
        p.name = vm.envOr("TOKEN_NAME", string("Squeektoshi Care Fund"));
        p.symbol = vm.envOr("TOKEN_SYMBOL", string("CARE"));
        p.supply = vm.envOr("TOKEN_SUPPLY", DEFAULT_SUPPLY);
        p.launchFdvWei = vm.envOr("LAUNCH_FDV_WEI", uint256(1 ether));
        p.poolManager = vm.envOr("POOL_MANAGER", SEPOLIA_POOL_MANAGER);
        p.positionManager = vm.envOr("POSITION_MANAGER", SEPOLIA_POSITION_MANAGER);
        p.permit2 = vm.envOr("PERMIT2", PERMIT2_DEFAULT);
        p.feed = vm.envOr("ETH_USD_FEED", SEPOLIA_ETH_USD_FEED);
        p.lpFee = uint24(vm.envOr("LP_FEE", uint256(0)));
        p.tickSpacing = int24(int256(vm.envOr("TICK_SPACING", uint256(60))));
        p.minBurnEth = vm.envOr("BURN_MIN_ETH", uint256(0.005 ether));
        p.maxBurnSlippageBps = vm.envOr("BURN_MAX_SLIPPAGE_BPS", uint256(300));
        p.airdropRoot = vm.envBytes32("AIRDROP_ROOT");
        p.airdropSnapshotBlock = vm.envUint("AIRDROP_SNAPSHOT_BLOCK");
        p.airdropBps = vm.envOr("AIRDROP_BPS", uint256(700));
        p.airdropDays = vm.envOr("AIRDROP_DAYS", uint256(60));
        require(p.airdropBps < 10_000, "airdrop share must be below 100%");
        require(p.keeper != address(0) && p.rescue != address(0), "KEEPER and RESCUE are required");
        require(p.launchFdvWei > 0 && p.supply > 0, "supply and launch FDV must be positive");
    }

    function _deploy(Params memory p, address deployer) internal {
        // 1. the token: the whole supply to the deployer, for a moment. 7% goes to the airdrop and the
        //    rest into the pool, so the deployer ends with nothing.
        token = new CareToken(p.name, p.symbol, p.supply, deployer);

        // 2. the vault
        vault = new CareVault(
            p.keeper,
            p.rescue,
            AggregatorV3Interface(p.feed),
            p.monthlyUsd * 1e8,
            30 days, // grace after retire()
            2 hours // maximum accepted price age
        );

        // 2b. the holders' ballot on the allowance, linked to the vault once
        ballot = new CareBallot(IERC20(address(token)), ICareVaultAllowance(address(vault)));
        vault.bindBallot(address(ballot));

        // 2c. the Squeek Genesis airdrop, funded with its share of the supply
        airdrop = new CareAirdrop(IERC20(address(token)), p.airdropRoot, p.airdropSnapshotBlock, p.airdropDays);
        token.transfer(address(airdrop), (p.supply * p.airdropBps) / 10_000);

        // 3. the burner, then the hook that names it, then the one-time link back. Separate
        //    transactions: on current Sepolia storing both contracts' code at once exceeds the
        //    per-transaction gas cap.
        BuybackBurner burner_ = new BuybackBurner(
            IPoolManager(p.poolManager), address(token), p.lpFee, p.tickSpacing, p.minBurnEth, p.maxBurnSlippageBps
        );
        hook = CareHook(
            _deployMined(
                type(CareHook).creationCode,
                abi.encode(p.poolManager, address(vault), address(token), p.lpFee, p.tickSpacing, address(burner_))
            )
        );
        burner_.bindHook(address(hook));

        // 4. the pool, opened exactly on a tick boundary at the launch price
        _poolKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: p.lpFee,
            tickSpacing: p.tickSpacing,
            hooks: IHooks(address(hook))
        });
        launchTick = _launchTick(p.supply, p.launchFdvWei, p.tickSpacing);
        uint160 launchSqrtPrice = TickMath.getSqrtPriceAtTick(launchTick);
        IPoolManager(p.poolManager).initialize(_poolKey, launchSqrtPrice);

        // 5. everything the deployer still holds as one token-only position below the launch price.
        //    Buyers move the price into it; the position is minted to the dead address, so nobody can
        //    remove it.
        _addLockedLiquidity(p, launchSqrtPrice, token.balanceOf(deployer));

        // anything rounding left behind is burned, so the deployer holds nothing
        uint256 dust = token.balanceOf(deployer);
        if (dust > 0) token.transfer(BURN_ADDRESS, dust);
    }

    function _addLockedLiquidity(Params memory p, uint160 launchSqrtPrice, uint256 amount) internal {
        int24 lower = TickMath.minUsableTick(p.tickSpacing);
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(lower);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmount1(sqrtLower, launchSqrtPrice, amount);

        token.approve(p.permit2, amount);
        IPermit2Approve(p.permit2)
            .approve(address(token), p.positionManager, uint160(amount), uint48(block.timestamp + 1 hours));

        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            _poolKey, lower, launchTick, uint256(liquidity), uint128(0), uint128(amount), BURN_ADDRESS, bytes("")
        );
        params[1] = abi.encode(_poolKey.currency0, _poolKey.currency1);

        lpTokenId = IPositionManagerMin(p.positionManager).nextTokenId();
        IPositionManagerMin(p.positionManager)
            .modifyLiquidities(
                abi.encode(abi.encodePacked(MINT_POSITION, SETTLE_PAIR), params), block.timestamp + 1 hours
            );
    }

    /// @dev Pool price is token1 per token0 = CARE per ETH. With both at 18 decimals that is
    ///      supply / launchFdvWei. Rounded down to a usable tick, so the pool opens exactly on the top
    ///      edge of the position.
    function _launchTick(uint256 supply, uint256 fdvWei, int24 spacing) internal pure returns (int24) {
        uint256 ratioX192 = FullMath.mulDiv(supply, 1 << 192, fdvWei);
        uint160 sqrtPrice = uint160(_sqrt(ratioX192));
        require(sqrtPrice > TickMath.MIN_SQRT_PRICE && sqrtPrice < TickMath.MAX_SQRT_PRICE, "launch price out of range");
        int24 tick = TickMath.getTickAtSqrtPrice(sqrtPrice);
        int24 aligned = (tick / spacing) * spacing;
        if (tick < 0 && aligned != tick) aligned -= spacing; // round toward -infinity
        require(aligned > TickMath.minUsableTick(spacing), "launch price too low for a position");
        return aligned;
    }

    /// @dev Mines a hook address whose flag bits match the callbacks, then deploys through the
    ///      canonical CREATE2 deployer. If the bits did not match, the hook's constructor reverts.
    function _deployMined(bytes memory creationCode, bytes memory args) internal returns (address deployed) {
        uint160 flags = uint160(
            Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
                | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        (address expected, bytes32 salt) = HookMiner.find(CREATE2_DEPLOYER, flags, creationCode, args);

        (bool ok,) = CREATE2_DEPLOYER.call(abi.encodePacked(salt, abi.encodePacked(creationCode, args)));
        require(ok, "create2 deployment failed");
        require(expected.code.length > 0, "hook has no code");
        return expected;
    }

    function _sqrt(uint256 x) internal pure returns (uint256 z) {
        if (x == 0) return 0;
        z = x;
        uint256 y = (x + 1) / 2;
        while (y < z) {
            z = y;
            y = (x / y + y) / 2;
        }
    }

    // ---------------------------------------------------------------- read-back for tests

    function poolKey() external view returns (PoolKey memory) {
        return _poolKey;
    }

    function burner() external view returns (BuybackBurner) {
        return hook.burner();
    }

    function _log(Params memory p) internal view {
        console2.log("");
        console2.log("Squeektoshi Care Fund deployed");
        console2.log("  token   ", address(token));
        console2.log("  vault   ", address(vault));
        console2.log("  hook    ", address(hook));
        console2.log("  burner  ", address(hook.burner()));
        console2.log("  ballot  ", address(ballot));
        console2.log("  airdrop ", address(airdrop));
        console2.log("  keeper  ", p.keeper);
        console2.log("  rescue  ", p.rescue);
        console2.log("  LP NFT  ", lpTokenId, "(owned by 0x...dEaD)");
        console2.log("  pool fee / tick spacing", uint256(p.lpFee), uint256(int256(p.tickSpacing)));
        console2.log("  launch tick", launchTick);
        console2.log("  allowance per month, USD", p.monthlyUsd);
        console2.log("");
        console2.log("Put token, vault, hook, keeper, rescue, pool.fee, pool.tickSpacing and the deploy block");
        console2.log("into backend/config/care.json.");
    }
}
