// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Deployers} from "v4-core/test/utils/Deployers.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {HookMiner} from "v4-periphery/test/shared/HookMiner.sol";
import {CareToken} from "../src/CareToken.sol";
import {CareVault} from "../src/CareVault.sol";
import {CareHook} from "../src/CareHook.sol";
import {BuybackBurner} from "../src/BuybackBurner.sol";
import {MockFeed} from "./utils/MockFeed.sol";

/// @notice The buyback and burn, against a real v4 PoolManager with real liquidity. The ETH the
///         burner spends is the ETH the hook actually charged on a swap, and the token it destroys
///         is bought from the pool.
contract BuybackBurnerTest is Test, Deployers {
    uint256 constant MONTHLY_USD = 1000e8;
    uint256 constant PRICE = 2000e8;
    uint256 constant MIN_BURN_ETH = 0.005 ether;
    uint256 constant MAX_SLIPPAGE_BPS = 300;

    CareToken token;
    MockFeed feed;
    CareVault vault;
    CareHook hook;
    BuybackBurner burner;
    PoolKey careKey;

    function setUp() public {
        vm.warp(1_700_000_000);
        deployFreshManagerAndRouters();

        token = new CareToken("Squeektoshi Care Fund", "CARE", 1_000_000_000e18, address(this));
        feed = new MockFeed(int256(PRICE), block.timestamp);
        vault = new CareVault(makeAddr("keeper"), makeAddr("rescue"), feed, MONTHLY_USD, 30 days, 2 hours);

        uint160 flags = uint160(
            Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
                | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        burner =
            new BuybackBurner(IPoolManager(address(manager)), address(token), 0, 60, MIN_BURN_ETH, MAX_SLIPPAGE_BPS);
        (address expected, bytes32 salt) = HookMiner.find(
            address(this),
            flags,
            type(CareHook).creationCode,
            abi.encode(address(manager), address(vault), address(token), uint24(0), int24(60), address(burner))
        );
        hook = new CareHook{salt: salt}(IPoolManager(address(manager)), vault, address(token), 0, 60, burner);
        assertEq(address(hook), expected, "hook landed on a bad address");
        burner.bindHook(address(hook));

        careKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: 0,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        manager.initialize(careKey, SQRT_PRICE_1_1);

        token.approve(address(modifyLiquidityRouter), type(uint256).max);
        token.approve(address(swapRouter), type(uint256).max);
        modifyLiquidityRouter.modifyLiquidity{value: 100 ether}(
            careKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -887220, tickUpper: 887220, liquidityDelta: 100e18, salt: 0
            }),
            ""
        );
    }

    /// @dev The burner is bound to the hook, and the hook names the burner.
    function test_wiring() public view {
        assertEq(address(burner.poolManager()), address(manager));
        assertEq(burner.hook(), address(hook));
        assertEq(burner.token(), address(token));
        assertEq(burner.poolFee(), 0);
        assertEq(burner.tickSpacing(), 60);
        assertEq(burner.minEthToBurn(), MIN_BURN_ETH);
        assertEq(burner.maxSlippageBps(), MAX_SLIPPAGE_BPS);
        assertEq(burner.BURN_ADDRESS(), 0x000000000000000000000000000000000000dEaD);

        PoolKey memory fromBurner = burner.poolKey();
        assertEq(Currency.unwrap(fromBurner.currency0), Currency.unwrap(careKey.currency0));
        assertEq(Currency.unwrap(fromBurner.currency1), Currency.unwrap(careKey.currency1));
        assertEq(uint256(fromBurner.fee), uint256(careKey.fee));
        assertEq(int256(fromBurner.tickSpacing), int256(careKey.tickSpacing));
        assertEq(address(fromBurner.hooks), address(careKey.hooks));

        // the hook exposes the same pool, so the two can be compared from outside
        PoolKey memory fromHook = hook.poolKey();
        assertEq(address(fromHook.hooks), address(hook));
        assertEq(Currency.unwrap(fromHook.currency1), address(token));
    }

    /// @dev A real swap funds the burner; the burn then spends exactly that ETH on the token.
    function test_burnSpendsTheFeeEth_andDestroysTheTokenItBuys() public {
        _fillVault();
        swap(careKey, true, -1 ether, "");
        assertEq(address(burner).balance, 0.05 ether, "with the vault full, the whole fee arrived here");

        uint256 deadBefore = token.balanceOf(burner.BURN_ADDRESS());
        uint256 vaultBefore = address(vault).balance;
        uint256 poolBefore = address(manager).balance;
        uint256 ethIn = address(burner).balance;

        uint256 minOut = (burner.spotTokensForEth(ethIn) * 99) / 100;
        uint256 burned = burner.burn(0, minOut);

        assertGt(burned, 0, "tokens were bought");
        assertEq(token.balanceOf(burner.BURN_ADDRESS()) - deadBefore, burned, "they went to the dead address");
        assertEq(address(burner).balance, 0, "the burner keeps nothing");
        assertEq(address(manager).balance, poolBefore + ethIn, "the ETH went into the pool");
        assertEq(address(vault).balance, vaultBefore, "the buyback itself is not taxed");
    }

    /// @dev The event is what the site reads to show how much has been burned, so check it exactly.
    function test_burnEmitsTheAmounts() public {
        vm.deal(address(burner), 0.05 ether);
        uint256 minOut = (burner.spotTokensForEth(0.05 ether) * 99) / 100;

        vm.recordLogs();
        uint256 burned = burner.burn(0.05 ether, minOut);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32 signature = keccak256("Burned(uint256,uint256,address)");
        bool found;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(burner) || logs[i].topics[0] != signature) continue;
            found = true;
            assertEq(logs[i].topics[1], bytes32(uint256(uint160(address(this)))), "the caller is indexed");
            (uint256 ethIn, uint256 tokensBurned) = abi.decode(logs[i].data, (uint256, uint256));
            assertEq(ethIn, 0.05 ether, "the ETH spent is in the event");
            assertEq(tokensBurned, burned, "so is what it bought");
        }
        assertTrue(found, "Burned was emitted");
        assertGt(burned, 0);
    }

    function test_burnCanBePartial() public {
        vm.deal(address(burner), 0.05 ether);

        burner.burn(0.01 ether, (burner.spotTokensForEth(0.01 ether) * 99) / 100);

        assertEq(address(burner).balance, 0.04 ether, "only what was asked for was spent");
    }

    /// @dev The floor exists so gas is never spent buying a few wei of the token.
    function test_burnReverts_belowTheFloor() public {
        vm.deal(address(burner), MIN_BURN_ETH - 1);
        vm.expectRevert(abi.encodeWithSelector(BuybackBurner.BelowMinimum.selector, MIN_BURN_ETH - 1, MIN_BURN_ETH));
        burner.burn(0, 0);
    }

    function test_burnReverts_whenThereIsNothingToBurn() public {
        vm.expectRevert(BuybackBurner.NothingToBurn.selector);
        burner.burn(0, 0);
    }

    /// @dev The caller picks the bound, but it can never be looser than the ceiling: that is what
    ///      stops a sandwich from being baited with a zero bound.
    function test_burnReverts_whenTheBoundIsLooserThanTheCeiling() public {
        vm.deal(address(burner), 0.05 ether);
        uint256 floor = burner.slippageFloor(0.05 ether);

        vm.expectRevert(abi.encodeWithSelector(BuybackBurner.SlippageBoundTooLoose.selector, floor - 1, floor));
        burner.burn(0.05 ether, floor - 1);

        // exactly at the ceiling is allowed
        burner.burn(0.05 ether, floor);
    }

    function test_burnReverts_whenThePoolCannotFillTheBound() public {
        vm.deal(address(burner), 0.05 ether);
        uint256 tooHopeful = burner.spotTokensForEth(0.05 ether) * 2;

        vm.expectRevert();
        burner.burn(0.05 ether, tooHopeful);
    }

    function test_burnIsPermissionless() public {
        vm.deal(address(burner), 0.05 ether);
        uint256 minOut = (burner.spotTokensForEth(0.05 ether) * 99) / 100;

        vm.prank(address(0xB0B));
        burner.burn(0.05 ether, minOut);

        assertEq(address(burner).balance, 0, "a stranger triggered a legitimate burn");
    }

    /// @dev The burn does not depend on the vault: ETH sitting here can be spent whatever the vault
    ///      holds, including after the fund has closed.
    function test_burnWorksWhateverTheVaultHolds() public {
        vm.deal(address(burner), 0.05 ether);
        uint256 burned = burner.burn(0.05 ether, (burner.spotTokensForEth(0.05 ether) * 99) / 100);
        assertGt(burned, 0, "with an empty vault");

        _fillVault();
        vm.deal(address(burner), 0.05 ether);
        burned = burner.burn(0.05 ether, (burner.spotTokensForEth(0.05 ether) * 99) / 100);
        assertGt(burned, 0, "with a full vault");
    }

    function _fillVault() internal {
        vm.deal(address(this), address(this).balance + 0.5 ether);
        (bool ok,) = address(vault).call{value: 0.5 ether}(""); // $1,000 at $2,000: full
        require(ok, "donation failed");
        assertEq(vault.careShortfallEth(), 0);
    }

    function test_spotPriceMatchesWhatThePoolActuallyPays() public {
        uint256 ethIn = 0.05 ether;
        uint256 spot = burner.spotTokensForEth(ethIn);

        vm.deal(address(burner), ethIn);
        uint256 received = burner.burn(ethIn, (spot * 99) / 100);

        // a 0.05 ETH buy in a 100 ETH pool: the fill is within a fraction of a percent of spot
        assertGt(received, (spot * 99) / 100, "fills at least 99% of spot");
        assertLe(received, spot, "and never more than spot");
    }
}
