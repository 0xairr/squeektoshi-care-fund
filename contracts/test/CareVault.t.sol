// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {CareVault} from "../src/CareVault.sol";
import {MockFeed} from "./utils/MockFeed.sol";

contract CareVaultTest is Test {
    uint256 constant MONTHLY_USD = 1000e8; // $1,000 a month
    uint256 constant WEEKLY_USD = 23_076_923_076; // $1,000 * 12 / 52, 8 decimals
    uint256 constant PRICE = 2000e8; // $2,000 per ETH
    uint256 constant WEEKLY_ETH = 115_384_615_380_000_000; // ~0.11538 ETH
    uint256 constant CAP_ETH = 500e15; // $1,000 at $2,000
    uint256 constant GRACE = 30 days;
    uint256 constant MAX_AGE = 2 hours;
    uint256 constant T0 = 1_700_000_000;

    address keeper = address(0xdead01);
    address rescue = address(0xdead02);

    MockFeed feed;
    CareVault vault;

    function setUp() public {
        vm.warp(T0);
        feed = new MockFeed(int256(PRICE), block.timestamp);
        vault = new CareVault(keeper, rescue, feed, MONTHLY_USD, GRACE, MAX_AGE);
    }

    /// @dev Warp time and refresh the mock price, so only the tests that mean to go stale do.
    function _warp(uint256 delta) internal {
        vm.warp(block.timestamp + delta);
        feed.set(feed.answer(), block.timestamp);
    }

    function _fund(uint256 eth) internal {
        vm.deal(address(this), address(this).balance + eth);
        (bool ok,) = address(vault).call{value: eth}("");
        require(ok, "fund failed");
    }

    function _retireAndSweep() internal {
        vm.prank(keeper);
        vault.retire();
        _warp(GRACE);
        vault.sweep();
    }

    // ------------------------------------------------------------- config

    function test_config_isFixed() public view {
        assertEq(vault.keeper(), keeper);
        assertEq(vault.rescue(), rescue);
        assertEq(vault.monthlyAllowanceUsd(), MONTHLY_USD);
        assertEq(vault.capUsd(), MONTHLY_USD, "cap is one month");
        assertEq(vault.weeklyAllowanceUsd(), WEEKLY_USD);
        assertEq(vault.paidThrough(), T0);
        assertEq(vault.lastPaidAt(), T0);
        assertFalse(vault.swept());
    }

    function test_constructor_rejectsBadConfig() public {
        vm.expectRevert(CareVault.ZeroAddress.selector);
        new CareVault(address(0), rescue, feed, MONTHLY_USD, GRACE, MAX_AGE);

        vm.expectRevert(CareVault.InvalidConfig.selector);
        new CareVault(keeper, rescue, feed, 0, GRACE, MAX_AGE);

        vm.expectRevert(CareVault.InvalidConfig.selector);
        new CareVault(keeper, rescue, feed, MONTHLY_USD, GRACE, 25 hours);
    }

    function test_constructor_rejectsAFeedWithNoCode() public {
        vm.expectRevert(CareVault.InvalidConfig.selector);
        new CareVault(keeper, rescue, MockFeed(address(0xfeed)), MONTHLY_USD, GRACE, MAX_AGE);
    }

    // ------------------------------------------------------------- money in

    function test_deposit_emitsAndCounts() public {
        vm.deal(address(this), 1 ether);
        vm.expectEmit(true, false, false, true, address(vault));
        emit CareVault.Deposited(address(this), 1 ether, 1 ether);
        vault.donate{value: 1 ether}();
        assertEq(address(vault).balance, 1 ether);
    }

    function test_emptyCall_isIgnored_notRejected() public {
        // A vault that reverts on an empty transfer could break a swap that is paying it.
        vault.donate{value: 0}();
        (bool ok,) = address(vault).call{value: 0}("");
        assertTrue(ok, "an empty call must not revert");
    }

    function test_depositWithADeadFeed_stillWorks() public {
        feed.setRevert(true);
        _fund(CAP_ETH);
        assertEq(address(vault).balance, CAP_ETH);
    }

    // ------------------------------------------------------------- the shortfall the hook reads

    function test_shortfall_isWhatIsMissingFromAMonth() public {
        assertEq(vault.careShortfallEth(), CAP_ETH, "an empty vault is a full month short");
        _fund(0.2 ether);
        assertEq(vault.careShortfallEth(), CAP_ETH - 0.2 ether);
        _fund(0.3 ether);
        assertEq(vault.careShortfallEth(), 0, "full");
        _fund(1 ether);
        assertEq(vault.careShortfallEth(), 0, "over the cap is still zero");
        assertTrue(vault.isFunded());
    }

    function test_shortfall_followsThePrice() public {
        _fund(CAP_ETH);
        feed.setPrice(int256(PRICE / 2));
        assertEq(vault.careShortfallEth(), CAP_ETH, "ETH halved: a month costs twice as many ETH");
    }

    function test_shortfall_withAnUnusablePrice_isEverything_andTheCapIsUnknown() public {
        feed.set(int256(PRICE), block.timestamp - 3 hours);
        assertEq(vault.careShortfallEth(), type(uint256).max, "stale");
        assertEq(vault.capEth(), 0);

        feed.set(0, block.timestamp);
        assertEq(vault.careShortfallEth(), type(uint256).max, "zero answer");

        feed.set(int256(PRICE), block.timestamp + 1);
        assertEq(vault.careShortfallEth(), type(uint256).max, "a timestamp from the future");

        feed.setRevert(true);
        assertEq(vault.careShortfallEth(), type(uint256).max, "reverting feed");
    }

    function test_shortfall_isZeroOnceClosed_evenWithABrokenFeed() public {
        _fund(0.1 ether);
        _retireAndSweep();
        assertEq(vault.careShortfallEth(), 0, "a closed vault asks the hook for nothing");
        feed.setRevert(true);
        assertEq(vault.careShortfallEth(), 0, "and the feed no longer matters");
    }

    // ------------------------------------------------------------- payouts

    function test_pay_tooSoon_reverts() public {
        _fund(CAP_ETH);
        vm.expectRevert(abi.encodeWithSelector(CareVault.TooSoon.selector, T0 + 7 days));
        vault.pay();
    }

    function test_pay_oneWeek_paysWeeklyAmount() public {
        _fund(CAP_ETH);
        _warp(7 days);

        (uint256 amount, uint256 weeksPaid) = vault.pay();

        assertEq(weeksPaid, 1);
        assertEq(amount, WEEKLY_ETH);
        assertEq(keeper.balance, WEEKLY_ETH);
        assertEq(vault.paidThrough(), T0 + 7 days);
        assertEq(vault.lastPaidAt(), block.timestamp);
    }

    function test_pay_isOncePerWeek() public {
        _fund(CAP_ETH);
        _warp(7 days);
        vault.pay();
        vm.expectRevert(abi.encodeWithSelector(CareVault.TooSoon.selector, T0 + 14 days));
        vault.pay();
    }

    function test_pay_anyoneCanCall_butOnlyTheKeeperIsPaid() public {
        _fund(CAP_ETH);
        _warp(7 days);
        vm.prank(address(0xB0B));
        vault.pay();
        assertEq(keeper.balance, WEEKLY_ETH);
        assertEq(address(0xB0B).balance, 0);
    }

    function test_pay_catchesUpMissedWeeks() public {
        _fund(CAP_ETH);
        _warp(21 days);
        (uint256 amount, uint256 weeksPaid) = vault.pay();
        assertEq(weeksPaid, 3, "three weeks settled in one call");
        assertEq(amount, WEEKLY_ETH * 3);
        assertEq(vault.nextPayoutAt(), block.timestamp + 7 days);
    }

    function test_pay_neverPaysMoreThanTheVaultHolds_andNeverLosesAWeek() public {
        _fund(WEEKLY_ETH * 2); // two weeks of money
        _warp(70 days); // ten weeks owed

        (, uint256 weeksPaid) = vault.pay();

        assertEq(weeksPaid, 2, "paid what the vault could cover");
        assertEq(vault.paidThrough(), T0 + 14 days, "the clock did not skip the unpaid weeks");
        assertEq(vault.weeksOwed(), 8, "the missed weeks are still owed");
    }

    function test_pay_catchUpIsBounded() public {
        _fund(100 ether);
        _warp(400 days);
        (, uint256 weeksPaid) = vault.pay();
        assertEq(weeksPaid, vault.MAX_CATCHUP_WEEKS());
    }

    function test_pay_withEmptyVault_reverts() public {
        _warp(7 days);
        vm.expectRevert(CareVault.NothingToPay.selector);
        vault.pay();
    }

    function test_pay_withStalePrice_reverts() public {
        _fund(CAP_ETH);
        _warp(7 days);
        feed.set(int256(PRICE), block.timestamp - 3 hours);
        vm.expectRevert(abi.encodeWithSelector(CareVault.StalePrice.selector, block.timestamp - 3 hours));
        vault.pay();
    }

    function test_pay_withNonPositivePrice_reverts() public {
        _fund(CAP_ETH);
        _warp(7 days);
        feed.set(0, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(CareVault.BadPrice.selector, int256(0)));
        vault.pay();
    }

    function test_pay_toAKeeperThatRejects_reverts_andKeepsTheWeek() public {
        Rejector bad = new Rejector();
        CareVault v = new CareVault(address(bad), rescue, feed, MONTHLY_USD, GRACE, MAX_AGE);
        vm.deal(address(v), CAP_ETH);
        _warp(7 days);
        vm.expectRevert(CareVault.TransferFailed.selector);
        v.pay();
        assertEq(v.weeksOwed(), 1, "nothing was marked paid");
    }

    // ------------------------------------------------------------- end clause

    function test_retire_onlyKeeperOrRescue() public {
        vm.expectRevert(CareVault.NotAuthorized.selector);
        vault.retire();

        vm.prank(keeper);
        vault.retire();
        assertEq(vault.retiredAt(), block.timestamp);

        vm.expectRevert(CareVault.AlreadyRetired.selector);
        vm.prank(rescue);
        vault.retire();
    }

    function test_retire_keepsPayingThroughTheGracePeriod() public {
        _fund(CAP_ETH);
        vm.prank(rescue);
        vault.retire();
        _warp(7 days);
        (uint256 amount,) = vault.pay();
        assertEq(amount, WEEKLY_ETH);
        assertGt(vault.careShortfallEth(), 0, "and the fee still refills it while it winds down");
    }

    function test_sweep_beforeTheEnd_reverts() public {
        _fund(CAP_ETH);
        vm.expectRevert(CareVault.NotSweepable.selector);
        vault.sweep();
    }

    function test_sweep_beforeTheGraceEnds_reverts() public {
        _fund(CAP_ETH);
        vm.prank(keeper);
        vault.retire();
        _warp(GRACE - 1);
        vm.expectRevert(CareVault.NotSweepable.selector);
        vault.sweep();
    }

    function test_sweep_afterGrace_sendsEverythingToRescue() public {
        _fund(CAP_ETH);
        _retireAndSweep();
        assertEq(rescue.balance, CAP_ETH);
        assertEq(address(vault).balance, 0);
        assertTrue(vault.swept());
    }

    function test_sweep_canForwardLateDonations() public {
        _fund(CAP_ETH);
        _retireAndSweep();

        _fund(0.01 ether); // someone donates after the end
        vm.prank(address(0xB0B));
        uint256 amount = vault.sweep();
        assertEq(amount, 0.01 ether, "nothing is ever stuck in a closed vault");
        assertEq(rescue.balance, CAP_ETH + 0.01 ether);
    }

    function test_pay_afterSweep_reverts() public {
        _fund(CAP_ETH);
        _retireAndSweep();
        _warp(7 days);
        vm.expectRevert(CareVault.AlreadySwept.selector);
        vault.pay();
    }

    function test_sweep_whenNobodyCollectsForNinetyDays_anyoneCanTrigger() public {
        _fund(CAP_ETH);
        _warp(90 days);
        vm.prank(address(0xBEEF01)); // a stranger, not the keeper or the rescue
        uint256 amount = vault.sweep();
        assertEq(amount, CAP_ETH);
        assertEq(rescue.balance, CAP_ETH, "the money goes to the rescue, not to the caller");
    }

    function test_sweep_aRecentPayoutResetsTheSilence() public {
        _fund(2 ether);
        _warp(30 days);
        vault.pay(); // pays 4 weeks now
        _warp(89 days);
        vm.expectRevert(CareVault.NotSweepable.selector);
        vault.sweep();
        _warp(1 days);
        vault.sweep(); // 90 days since the keeper was actually paid
    }

    /// @dev The bug this replaces: the silence used to be measured from the payout clock, which
    ///      lags behind after slow weeks. Paying one late week left the vault sweepable by anyone.
    function test_sweep_payingABacklog_doesNotLeaveTheVaultSweepable() public {
        _warp(100 days); // three slow months: nothing to pay
        _fund(WEEKLY_ETH); // trading finally covers one week
        vault.pay(); // the clock moves one week, but the keeper was just paid
        vm.expectRevert(CareVault.NotSweepable.selector);
        vault.sweep();
    }

    /// @dev A vault too poor to pay a single week is not abandoned: slow trading must not let a
    ///      stranger close the fund.
    function test_sweep_aPoorVaultIsNeverAbandoned() public {
        _fund(WEEKLY_ETH - 1);
        _warp(365 days);
        vm.expectRevert(CareVault.NotSweepable.selector);
        vault.sweep();
    }

    function test_sweep_silenceNeedsAUsablePrice() public {
        _fund(CAP_ETH);
        vm.warp(block.timestamp + 90 days);
        feed.set(int256(PRICE), block.timestamp - 3 hours); // stale: nobody could have paid
        vm.expectRevert(CareVault.NotSweepable.selector);
        vault.sweep();
    }

    // ------------------------------------------------------------- views

    function test_preview() public {
        _fund(CAP_ETH);
        _warp(14 days);
        (
            uint256 balance,
            uint256 balanceUsd,
            bool priceOk,
            uint256 price,
            uint256 cap,
            uint256 weeklyUsd,
            uint256 weeklyEth,
            uint256 nextPayout,
            uint256 owedWeeks,
            bool closed
        ) = vault.preview();
        assertEq(balance, CAP_ETH);
        assertEq(balanceUsd, MONTHLY_USD);
        assertTrue(priceOk);
        assertEq(price, PRICE);
        assertEq(cap, MONTHLY_USD);
        assertEq(weeklyUsd, WEEKLY_USD);
        assertEq(weeklyEth, WEEKLY_ETH);
        assertEq(nextPayout, T0 + 7 days);
        assertEq(owedWeeks, 2);
        assertFalse(closed);
        assertEq(vault.vaultUsd(), MONTHLY_USD);
        assertEq(vault.capEth(), CAP_ETH);
    }

    function test_preview_neverRevertsOnADeadFeed() public {
        _fund(CAP_ETH);
        feed.setRevert(true);
        (uint256 balance, uint256 balanceUsd, bool priceOk,,,, uint256 weeklyEth,,,) = vault.preview();
        assertEq(balance, CAP_ETH);
        assertEq(balanceUsd, 0);
        assertFalse(priceOk);
        assertEq(weeklyEth, 0);
    }
}

contract Rejector {
    receive() external payable {
        revert("no");
    }
}
