// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {Deploy, IPositionManagerMin} from "../script/Deploy.s.sol";
import {CareToken} from "../src/CareToken.sol";
import {CareVault} from "../src/CareVault.sol";
import {CareHook} from "../src/CareHook.sol";
import {BuybackBurner} from "../src/BuybackBurner.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";

interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/// @notice The launch, rehearsed against live Sepolia: the real deploy script, the real PoolManager,
///         PositionManager, UniversalRouter, Permit2 and Chainlink feed. Buys and sells go through the
///         UniversalRouter with the same calldata the website builds (frontend/src/lib/swap.ts).
///
/// Run with:  SEPOLIA_RPC_URL=<rpc> forge test --match-contract SepoliaFork -vv
/// Skipped when no RPC is configured.
contract SepoliaForkTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
    address constant UNIVERSAL_ROUTER = 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant ETH_USD_FEED = 0x694AA1769357215DE4FAC081bf1f309aDC325306;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    // UniversalRouter commands and v4 actions, as the website uses them
    bytes constant BUY_COMMANDS = hex"1004"; // V4_SWAP, SWEEP
    bytes constant SELL_COMMANDS = hex"10"; // V4_SWAP
    bytes constant SWAP_ACTIONS = hex"060c0f"; // SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL

    /// @dev v4-periphery's ExactInputSingleParams, field for field.
    struct ExactInputSingleParams {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        uint256 minHopPriceX36;
        bytes hookData;
    }

    address keeper = makeAddr("keeper");
    address rescue = makeAddr("rescue");
    address buyer = makeAddr("buyer");

    Deploy deploy;
    CareToken token;
    CareVault vault;
    CareHook hook;
    BuybackBurner burner;
    PoolKey key;

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);

        vm.setEnv("KEEPER", vm.toString(keeper));
        vm.setEnv("RESCUE", vm.toString(rescue));
        vm.setEnv("AIRDROP_ROOT", vm.toString(bytes32(uint256(0xa1)))); // any root: the fork tests do not claim
        vm.setEnv("AIRDROP_SNAPSHOT_BLOCK", "1");
        deploy = new Deploy();
        deploy.rehearse();

        token = deploy.token();
        vault = deploy.vault();
        hook = deploy.hook();
        burner = deploy.burner();
        key = deploy.poolKey();
        vm.deal(buyer, 10 ether);
    }

    // ------------------------------------------------------------- helpers

    function _swapInput(bool zeroForOne, uint256 amountIn, uint256 minOut) internal view returns (bytes memory) {
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            ExactInputSingleParams({
                poolKey: key,
                zeroForOne: zeroForOne,
                amountIn: uint128(amountIn),
                amountOutMinimum: uint128(minOut),
                minHopPriceX36: 0,
                hookData: ""
            })
        );
        (Currency inC, Currency outC) = zeroForOne ? (key.currency0, key.currency1) : (key.currency1, key.currency0);
        params[1] = abi.encode(inC, amountIn); // SETTLE_ALL
        params[2] = abi.encode(outC, minOut); // TAKE_ALL
        return abi.encode(SWAP_ACTIONS, params);
    }

    function _buy(uint256 ethIn) internal returns (uint256 got) {
        bytes[] memory inputs = new bytes[](2);
        inputs[0] = _swapInput(true, ethIn, 0);
        inputs[1] = abi.encode(address(0), buyer, uint256(0)); // SWEEP leftover ETH back
        uint256 before = token.balanceOf(buyer);
        vm.prank(buyer);
        IUniversalRouter(UNIVERSAL_ROUTER).execute{value: ethIn}(BUY_COMMANDS, inputs, block.timestamp + 900);
        got = token.balanceOf(buyer) - before;
    }

    function _sell(uint256 tokensIn) internal returns (uint256 got) {
        vm.startPrank(buyer);
        token.approve(PERMIT2, type(uint256).max);
        IPermit2(PERMIT2)
            .approve(address(token), UNIVERSAL_ROUTER, type(uint160).max, uint48(block.timestamp + 30 days));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = _swapInput(false, tokensIn, 0);
        uint256 before = buyer.balance;
        IUniversalRouter(UNIVERSAL_ROUTER).execute(SELL_COMMANDS, inputs, block.timestamp + 900);
        vm.stopPrank();
        got = buyer.balance - before;
    }

    /// @dev Chainlink's answer, restamped "now", so tests that move time keep a fresh price.
    function _freshPrice() internal {
        (uint80 r, int256 answer,,, uint80 a) = AggregatorV3Interface(ETH_USD_FEED).latestRoundData();
        vm.mockCall(
            ETH_USD_FEED,
            abi.encodeWithSelector(AggregatorV3Interface.latestRoundData.selector),
            abi.encode(r, answer, block.timestamp, block.timestamp, a)
        );
    }

    function _fillVault() internal {
        uint256 cap = vault.capEth();
        assertGt(cap, 0, "the live feed prices a month of care");
        vm.deal(address(this), cap);
        (bool ok,) = address(vault).call{value: cap}("");
        require(ok);
        assertEq(vault.careShortfallEth(), 0);
    }

    // ------------------------------------------------------------- the launch

    function test_launch_theWholeSupplyIsInThePool_andTheLiquidityIsLocked() public view {
        assertEq(token.totalSupply(), 1_000_000_000e18);
        assertEq(token.balanceOf(address(deploy)), 0, "the deployer holds no tokens");
        assertGt(token.balanceOf(POOL_MANAGER), 929_999_999e18, "93% of the supply sits in the pool");
        assertEq(token.balanceOf(address(deploy.airdrop())), 70_000_000e18, "7% waits in the airdrop");
        assertEq(vault.ballot(), address(deploy.ballot()), "the ballot is bound to the vault");

        uint256 lp = deploy.lpTokenId();
        assertEq(IPositionManagerMin(POSITION_MANAGER).ownerOf(lp), DEAD, "the LP position belongs to nobody");
        assertGt(IPositionManagerMin(POSITION_MANAGER).getPositionLiquidity(lp), 0);

        (uint160 sqrtPriceX96, int24 tick,,) = IPoolManager(POOL_MANAGER).getSlot0(key.toId());
        assertGt(sqrtPriceX96, 0, "the pool is open");
        assertEq(tick, deploy.launchTick(), "it opens on the edge of the position");
    }

    function test_launch_contractsAreWiredAsDocumented() public view {
        assertEq(vault.keeper(), keeper);
        assertEq(vault.rescue(), rescue);
        assertEq(vault.monthlyAllowanceUsd(), 1000e8);
        assertEq(vault.weeklyAllowanceUsd(), 23_076_923_076, "$230.77 a week");
        assertEq(address(vault.ethUsdFeed()), ETH_USD_FEED);

        assertEq(hook.FEE_BPS(), 500);
        assertEq(address(hook.vault()), address(vault));
        assertEq(hook.careToken(), address(token));
        assertTrue(Hooks.hasPermission(IHooks(address(hook)), Hooks.BEFORE_SWAP_FLAG));
        assertTrue(Hooks.hasPermission(IHooks(address(hook)), Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG));
        assertEq(address(key.hooks), address(hook));

        assertEq(burner.hook(), address(hook));
        assertEq(burner.token(), address(token));
        assertEq(burner.minEthToBurn(), 0.005 ether);
        assertEq(burner.maxSlippageBps(), 300);
    }

    // ------------------------------------------------------------- trading through the real router

    function test_buy_throughTheUniversalRouter_paysFivePercentToCare() public {
        uint256 got = _buy(0.1 ether);

        assertGt(got, 0, "the buyer received tokens");
        assertEq(address(vault).balance, 0.005 ether, "5% of the ETH went to the vault");
        assertEq(address(burner).balance, 0, "nothing burns while the vault is short");
        assertEq(address(UNIVERSAL_ROUTER).balance, 0, "the router kept nothing");
    }

    function test_sell_throughTheUniversalRouter_paysFivePercentOfTheEthOut() public {
        uint256 bought = _buy(0.5 ether);
        uint256 vaultBefore = address(vault).balance;

        uint256 ethOut = _sell(bought / 2);

        assertGt(ethOut, 0, "the seller received ETH");
        uint256 fee = address(vault).balance - vaultBefore;
        assertApproxEqAbs(fee, (ethOut * 500) / 9_500, 2, "5% of the gross ETH out went to the vault");
    }

    function test_fullVault_theFeeBurns_andAnyoneCanTriggerTheBurn() public {
        _buy(0.2 ether); // some ETH in the pool first
        _fillVault();

        _buy(0.2 ether);
        uint256 pending = address(burner).balance;
        assertEq(pending, 0.01 ether, "the whole 5% went to the burner");

        uint256 deadBefore = token.balanceOf(DEAD);
        vm.prank(makeAddr("stranger"));
        uint256 burned = burner.burn(0, burner.slippageFloor(pending));

        assertGt(burned, 0);
        assertEq(token.balanceOf(DEAD) - deadBefore, burned, "the bought tokens are at the dead address");
        assertEq(address(burner).balance, 0);
    }

    function test_weeklyPayout_atTheLiveChainlinkPrice() public {
        _buy(1 ether); // 0.05 ETH to the vault
        _fillVault();
        vm.warp(block.timestamp + 7 days);
        _freshPrice();

        (uint256 amount, uint256 weeksPaid) = vault.pay();

        assertEq(weeksPaid, 1);
        assertEq(keeper.balance, amount);
        (, int256 answer,,,) = AggregatorV3Interface(ETH_USD_FEED).latestRoundData();
        assertEq(amount, (uint256(23_076_923_076) * 1e18) / uint256(answer), "one week of $230.77 in ETH");

        // the payout opened a gap, and the next fee refills it before anything burns
        uint256 burnBefore = address(burner).balance;
        _buy(0.1 ether);
        assertEq(address(burner).balance, burnBefore, "the refill comes first");
    }
}
