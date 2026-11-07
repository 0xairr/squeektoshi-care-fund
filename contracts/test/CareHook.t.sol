// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, Vm} from "forge-std/Test.sol";
import {Deployers} from "v4-core/test/utils/Deployers.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {HookMiner} from "v4-periphery/test/shared/HookMiner.sol";
import {CareToken} from "../src/CareToken.sol";
import {CareVault} from "../src/CareVault.sol";
import {CareHook} from "../src/CareHook.sol";
import {BuybackBurner} from "../src/BuybackBurner.sol";
import {MockFeed} from "./utils/MockFeed.sol";

/// @notice The fee never turns off: the vault is filled first and the rest buys the token back and
///         burns it. Everything runs against a real v4 PoolManager with real liquidity.
contract CareHookTest is Test, Deployers {
    uint256 constant MONTHLY_USD = 1000e8;
    uint256 constant PRICE = 2000e8;
    uint256 constant CAP_ETH = 500e15; // $1,000 at $2,000
    uint256 constant MIN_BURN_ETH = 0.005 ether;
    uint256 constant MAX_SLIPPAGE_BPS = 300;

    address keeper = makeAddr("keeper");
    address rescue = makeAddr("rescue");

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
        vault = new CareVault(keeper, rescue, feed, MONTHLY_USD, 30 days, 2 hours);

        burner =
            new BuybackBurner(IPoolManager(address(manager)), address(token), 0, 60, MIN_BURN_ETH, MAX_SLIPPAGE_BPS);
        (address expected, bytes32 salt) = HookMiner.find(
            address(this),
            _hookFlags(),
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

    function _hookFlags() internal pure returns (uint160) {
        return uint160(
            Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
                | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
    }

    function _donate(uint256 eth) internal {
        vm.deal(address(this), address(this).balance + eth);
        (bool ok,) = address(vault).call{value: eth}("");
        require(ok, "donate failed");
    }

    function _warp(uint256 by) internal {
        vm.warp(block.timestamp + by);
        feed.set(feed.answer(), block.timestamp);
    }

    function _care() internal view returns (uint256) {
        return address(vault).balance;
    }

    function _burn() internal view returns (uint256) {
        return address(burner).balance;
    }

    // ------------------------------------------------------------- care first, then the burn

    function test_whileTheVaultIsShort_theWholeFeeGoesToCare() public {
        swap(careKey, true, -1 ether, "");

        assertEq(_care(), 0.05 ether, "the whole 5% went to care");
        assertEq(_burn(), 0, "nothing went to the burn yet");
        assertEq(address(hook).balance, 0, "the hook never holds money");
    }

    function test_theVaultFillsToTheCapAndNotPastIt() public {
        _donate(0.45 ether); // $900 of $1,000: 0.05 ETH short
        assertEq(vault.careShortfallEth(), 0.05 ether, "the vault knows what it is missing");

        swap(careKey, true, -2 ether, ""); // a 0.1 ETH fee

        assertEq(_care(), CAP_ETH, "the vault landed exactly on the cap");
        assertEq(_burn(), 0.05 ether, "the rest of that same fee went to the burn");
        assertEq(vault.careShortfallEth(), 0, "and it is no longer short");
    }

    function test_onceFull_theWholeFeeBurns_andTheFeeStaysOn() public {
        _donate(CAP_ETH);

        swap(careKey, true, -3 ether, "");

        assertEq(_burn(), 0.15 ether, "5% of 3 ETH, all of it to the burn");
        assertEq(_care(), CAP_ETH, "care is untouched once it is full");
        (uint256 careShare, uint256 burnShare) = hook.splitFee(1 ether);
        assertEq(careShare, 0, "splitFee says care needs nothing");
        assertEq(burnShare, 1 ether, "so the whole fee is headed for the burn");
    }

    function test_aPayoutMakesTheVaultShortAgain_andTradingRefillsIt() public {
        _donate(CAP_ETH);
        _warp(7 days);
        vault.pay(); // $230.77 leaves
        uint256 short_ = vault.careShortfallEth();
        assertGt(short_, 0, "a payout opens a gap");

        swap(careKey, true, -1 ether, ""); // 0.05 ETH fee, less than the gap
        assertEq(_care(), CAP_ETH - short_ + 0.05 ether, "the fee refills care before anything burns");
        assertEq(_burn(), 0);
    }

    function test_aPriceFallMakesTheVaultShortAgain_byItself() public {
        _donate(CAP_ETH);
        feed.set(int256(1000e8), block.timestamp); // ETH halves: a month costs twice as many ETH
        assertEq(vault.careShortfallEth(), CAP_ETH, "the cap in ETH doubled");

        swap(careKey, true, -1 ether, "");
        assertEq(_care(), CAP_ETH + 0.05 ether, "the fee went back to care with nobody touching anything");
    }

    function test_aBrokenFeedKeepsTheFeeGoingToCare_andSwapsKeepWorking() public {
        _donate(CAP_ETH);
        feed.setRevert(true);

        swap(careKey, true, -1 ether, "");
        assertEq(_care(), CAP_ETH + 0.05 ether, "care still gets the fee when the cap cannot be priced");
        assertEq(_burn(), 0, "the burn waits for the feed rather than guessing");

        feed.setRevert(false);
        feed.set(int256(PRICE), block.timestamp);
        swap(careKey, true, -1 ether, "");
        assertEq(_burn(), 0.05 ether, "and the burn resumes on its own once the feed is back");
    }

    function test_aFeedTimestampInTheFutureDoesNotBreakSwaps() public {
        feed.set(int256(PRICE), block.timestamp + 1 hours);
        assertEq(vault.careShortfallEth(), type(uint256).max, "an impossible timestamp is not a price");
        swap(careKey, true, -1 ether, ""); // must not revert
        assertEq(_care(), 0.05 ether);
    }

    function test_afterTheFundCloses_everyFeeBurns() public {
        _donate(0.1 ether);
        vm.prank(keeper);
        vault.retire();
        _warp(30 days);
        vault.sweep();
        assertEq(_care(), 0);
        assertEq(vault.careShortfallEth(), 0, "a closed vault asks for nothing");

        swap(careKey, true, -1 ether, "");
        assertEq(_care(), 0, "nothing is stranded in a closed vault");
        assertEq(_burn(), 0.05 ether, "the whole fee burns");
    }

    function test_feeTakenEvent_reportsTheRoute() public {
        _donate(0.45 ether);
        vm.recordLogs();
        swap(careKey, true, -2 ether, "");
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32 topic = keccak256("FeeTaken(bool,uint256,uint256,uint256)");
        bool found;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(hook) && logs[i].topics[0] == topic) {
                assertEq(logs[i].topics[1], bytes32(uint256(1)), "a buy");
                (uint256 fee, uint256 toCare, uint256 toBurn) = abi.decode(logs[i].data, (uint256, uint256, uint256));
                assertEq(fee, 0.1 ether);
                assertEq(toCare, 0.05 ether);
                assertEq(toBurn, 0.05 ether);
                found = true;
            }
        }
        assertTrue(found, "the hook reports every fee it takes");
    }

    // ------------------------------------------------------------- splitFee

    function test_splitFeeFollowsTheShortfall() public {
        (uint256 care, uint256 burn) = hook.splitFee(0.05 ether);
        assertEq(care, 0.05 ether, "a fee smaller than the gap goes entirely to care");
        assertEq(burn, 0);
        (care, burn) = hook.splitFee(1 ether);
        assertEq(care, CAP_ETH, "a bigger fee only takes what care is missing");
        assertEq(burn, 1 ether - CAP_ETH, "and the rest is headed for the burn");

        _donate(0.4 ether); // 0.1 ETH short
        (care, burn) = hook.splitFee(0.2 ether);
        assertEq(care, 0.1 ether, "a larger fee fills the gap");
        assertEq(burn, 0.1 ether, "and the rest burns");
    }

    // ------------------------------------------------------------- the four swap shapes

    function test_exactInBuy_takesFivePercentOfTheEthIn() public {
        swap(careKey, true, -1 ether, "");
        assertEq(_care(), 0.05 ether);
    }

    function test_exactOutBuy_takesFivePercentOfTheEthIn() public {
        BalanceDelta delta = swapNativeInput(careKey, true, int256(0.1e18), "", 1 ether);

        uint256 paid = uint256(int256(-delta.amount0())); // the swapper's ETH outlay, fee included
        uint256 expectedFee = (paid * 500) / 10_500; // paid = input * 1.05
        assertApproxEqAbs(_care(), expectedFee, 2, "5% of the ETH input");
        assertEq(address(hook).balance, 0);
    }

    function test_exactInSell_takesFivePercentOfTheEthOut() public {
        BalanceDelta delta = swap(careKey, false, -100e18, "");

        uint256 received = uint256(int256(delta.amount0())); // the swapper's ETH, fee already taken
        uint256 expectedFee = (received * 500) / 9_500; // received = out * 0.95
        assertApproxEqAbs(_care() + _burn(), expectedFee, 2, "5% of the ETH out");
        assertEq(_care(), CAP_ETH, "care took only its gap, the rest went to the burn");
        assertEq(address(hook).balance, 0);
    }

    function test_exactOutSell_takesFivePercentOfTheEthOut() public {
        BalanceDelta delta = swap(careKey, false, int256(0.01 ether), "");

        assertEq(uint256(int256(delta.amount0())), 0.01 ether, "the swapper gets exactly what they asked for");
        assertEq(_care(), 0.0005 ether, "5% of the ETH out");
        assertEq(address(hook).balance, 0);
    }

    function test_tinySwap_roundsTheFeeToZero_andStillWorks() public {
        swap(careKey, true, -1, ""); // 1 wei: 5% rounds to 0
        assertEq(_care(), 0, "no dust fee");
    }

    // ------------------------------------------------------------- the buyback

    function test_theBuybackIsNotTaxed() public {
        _donate(CAP_ETH);
        vm.deal(address(burner), 0.05 ether);

        uint256 minOut = burner.slippageFloor(0.05 ether);
        burner.burn(0.05 ether, minOut);

        assertEq(_care(), CAP_ETH, "care is untouched by the buyback");
        assertEq(_burn(), 0, "the burner spent all of its ETH, none of it went back to itself as a fee");
    }

    // ------------------------------------------------------------- access and pinning

    function test_callbacksArePoolManagerOnly() public {
        IPoolManager.SwapParams memory params =
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -1 ether, sqrtPriceLimitX96: MIN_PRICE_LIMIT});

        vm.expectRevert(CareHook.NotPoolManager.selector);
        hook.beforeSwap(address(this), careKey, params, "");

        vm.expectRevert(CareHook.NotPoolManager.selector);
        hook.afterSwap(address(this), careKey, params, BalanceDelta.wrap(0), "");
    }

    function test_ignoresPoolsItWasNotDeployedFor() public {
        CareToken other = new CareToken("Other", "OTH", 1_000_000e18, address(this));
        PoolKey memory otherKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(other)),
            fee: 0,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        manager.initialize(otherKey, SQRT_PRICE_1_1);
        other.approve(address(modifyLiquidityRouter), type(uint256).max);
        modifyLiquidityRouter.modifyLiquidity{value: 20 ether}(
            otherKey,
            IPoolManager.ModifyLiquidityParams({tickLower: -887220, tickUpper: 887220, liquidityDelta: 20e18, salt: 0}),
            ""
        );

        swap(otherKey, true, -1 ether, "");
        assertEq(_care(), 0, "a foreign pool is not taxed");
    }

    function test_ignoresPoolsWithDifferentParameters() public {
        PoolKey memory otherKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: 500,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        manager.initialize(otherKey, SQRT_PRICE_1_1);
        modifyLiquidityRouter.modifyLiquidity{value: 20 ether}(
            otherKey,
            IPoolManager.ModifyLiquidityParams({tickLower: -887220, tickUpper: 887220, liquidityDelta: 20e18, salt: 0}),
            ""
        );

        swap(otherKey, true, -1 ether, "");
        assertEq(_care(), 0, "the hook is pinned to one pool key");
    }

    function test_hookAddressHasTheExpectedPermissions() public view {
        assertTrue(Hooks.hasPermission(IHooks(address(hook)), Hooks.BEFORE_SWAP_FLAG));
        assertTrue(Hooks.hasPermission(IHooks(address(hook)), Hooks.AFTER_SWAP_FLAG));
        assertTrue(Hooks.hasPermission(IHooks(address(hook)), Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG));
        assertTrue(Hooks.hasPermission(IHooks(address(hook)), Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG));
        assertFalse(Hooks.hasPermission(IHooks(address(hook)), Hooks.BEFORE_ADD_LIQUIDITY_FLAG));
        assertFalse(Hooks.hasPermission(IHooks(address(hook)), Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG));
    }

    function test_constructorRejectsAVaultOrTokenWithNoCode() public {
        vm.expectRevert(bytes("no vault"));
        new CareHook(
            IPoolManager(address(manager)), CareVault(payable(makeAddr("nothing"))), address(token), 0, 60, burner
        );
        vm.expectRevert(bytes("no token"));
        new CareHook(IPoolManager(address(manager)), vault, makeAddr("nothing"), 0, 60, burner);
    }

    function test_constructorRejectsABurnerForAnotherPool() public {
        BuybackBurner other = new BuybackBurner(IPoolManager(address(manager)), address(token), 500, 60, 1, 1);
        vm.expectRevert(bytes("burner is for another pool"));
        new CareHook(IPoolManager(address(manager)), vault, address(token), 0, 60, other);
    }

    // ------------------------------------------------------------- the one-time link from the burner

    function test_bindHook_isDeployerOnly_once_andChecksTheHook() public {
        BuybackBurner fresh = new BuybackBurner(IPoolManager(address(manager)), address(token), 0, 60, 1, 1);

        vm.prank(makeAddr("stranger"));
        vm.expectRevert(BuybackBurner.NotDeployer.selector);
        fresh.bindHook(address(hook));

        // the existing hook names a different burner, so this one cannot be pointed at it
        vm.expectRevert(BuybackBurner.WrongHook.selector);
        fresh.bindHook(address(hook));

        vm.expectRevert(BuybackBurner.AlreadyBound.selector);
        burner.bindHook(address(hook));
        assertEq(burner.hook(), address(hook));
    }

    function test_anUnboundBurnerCannotBurn() public {
        BuybackBurner fresh = new BuybackBurner(IPoolManager(address(manager)), address(token), 0, 60, 1, 1);
        vm.deal(address(fresh), 1 ether);
        vm.expectRevert(BuybackBurner.NotBound.selector);
        fresh.burn(0, 0);
    }

    // ------------------------------------------------------------- end to end

    function test_tradingAloneFillsTheVault_thenBurns_weekAfterWeek() public {
        // 2 ETH buys pay 0.1 ETH each: five of them fill the 0.5 ETH vault.
        for (uint256 i = 0; i < 5; i++) {
            swap(careKey, true, -2 ether, "");
        }
        assertEq(_care(), CAP_ETH, "filled by trading alone");
        assertEq(_burn(), 0);

        swap(careKey, true, -2 ether, "");
        assertEq(_burn(), 0.1 ether, "full: the next fee burns");

        for (uint256 w = 0; w < 3; w++) {
            _warp(7 days);
            (uint256 paid,) = vault.pay();
            assertGt(paid, 0, "the keeper is paid every week");
            uint256 burnBefore = _burn();
            swap(careKey, true, -10 ether, ""); // 0.5 ETH fee: refills the gap, the rest burns
            assertEq(_care(), CAP_ETH, "refilled to the cap");
            assertEq(_burn() - burnBefore, 0.5 ether - paid, "everything above the refill burned");
        }
    }
}
