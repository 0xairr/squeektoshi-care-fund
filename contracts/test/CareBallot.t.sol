// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CareToken} from "../src/CareToken.sol";
import {CareVault} from "../src/CareVault.sol";
import {CareBallot, ICareVaultAllowance} from "../src/CareBallot.sol";
import {MockFeed} from "./utils/MockFeed.sol";

contract CareBallotTest is Test {
    CareToken token;
    MockFeed feed;
    CareVault vault;
    CareBallot ballot;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new CareToken("Squeektoshi Care Fund", "CARE", 1_000_000_000e18, address(this));
        feed = new MockFeed(2000e8, block.timestamp);
        vault = new CareVault(makeAddr("keeper"), makeAddr("rescue"), feed, 1000e8, 30 days, 2 hours);
        ballot = new CareBallot(IERC20(address(token)), ICareVaultAllowance(address(vault)));
        vault.bindBallot(address(ballot));

        for (uint256 i; i < 3; i++) {
            address a = [alice, bob, carol][i];
            token.transfer(a, 1_000_000e18);
            vm.prank(a);
            token.approve(address(ballot), type(uint256).max);
        }
    }

    function _nextRound() internal {
        vm.warp(block.timestamp + 30 days);
        feed.set(feed.answer(), block.timestamp);
    }

    function test_options_runFrom300To1000() public view {
        assertEq(ballot.optionUsd(0), 300);
        assertEq(ballot.optionUsd(7), 1000);
    }

    function test_vote_locksTheCare_andCountsIt() public {
        vm.prank(alice);
        ballot.vote(2, 100e18); // $500
        assertEq(token.balanceOf(address(ballot)), 100e18);
        assertEq(ballot.weights(0)[2], 100e18);
        (uint8 option, bool voted) = ballot.choiceOf(0, alice);
        assertEq(option, 2);
        assertTrue(voted);
    }

    function test_votingAgain_addsToTheLock_andMovesIt() public {
        vm.startPrank(alice);
        ballot.vote(2, 100e18);
        ballot.vote(5, 50e18); // $800, now with 150
        vm.stopPrank();
        assertEq(ballot.weights(0)[2], 0, "the old option lost the weight");
        assertEq(ballot.weights(0)[5], 150e18, "all of it moved");
        assertEq(ballot.locked(0, alice), 150e18);
    }

    function test_changingYourMind_withoutAddingMore() public {
        vm.startPrank(alice);
        ballot.vote(2, 100e18);
        ballot.vote(0, 0);
        vm.stopPrank();
        assertEq(ballot.weights(0)[0], 100e18);
        assertEq(ballot.weights(0)[2], 0);
    }

    function test_theResultIsTheWeightedMedian_notTheAverage() public {
        vm.prank(alice);
        ballot.vote(0, 300e18); // $300
        vm.prank(bob);
        ballot.vote(1, 300e18); // $400
        vm.prank(carol);
        ballot.vote(7, 500e18); // $1,000, the largest single vote
        (uint256 usd, uint256 total) = ballot.result(0);
        assertEq(total, 1100e18);
        assertEq(usd, 400, "half the weight is at $400 or below, so a whale at $1,000 does not win alone");
    }

    function test_enact_setsTheAllowance_andTheWeeklyPayoutFollows() public {
        vm.prank(alice);
        ballot.vote(2, 100e18); // $500
        _nextRound();
        ballot.enact(0);
        assertEq(vault.monthlyAllowanceUsd(), 500e8);
        assertEq(vault.capUsd(), 500e8, "the vault's cap is one month of the new allowance");
        assertEq(vault.weeklyAllowanceUsd(), (uint256(500e8) * 12) / 52);
    }

    function test_enact_onlyAfterTheRoundEnds_onceEach_inOrder() public {
        vm.prank(alice);
        ballot.vote(2, 100e18);
        vm.expectRevert(CareBallot.RoundNotOver.selector);
        ballot.enact(0);

        _nextRound();
        _nextRound(); // round 1 has also ended, with no votes
        ballot.enact(1);
        vm.expectRevert(CareBallot.AlreadyEnacted.selector);
        ballot.enact(0); // an older round can no longer overwrite a newer one
        vm.expectRevert(CareBallot.AlreadyEnacted.selector);
        ballot.enact(1);
    }

    function test_aRoundWithNoVotes_leavesTheAllowanceAlone() public {
        _nextRound();
        ballot.enact(0);
        assertEq(vault.monthlyAllowanceUsd(), 1000e8);
    }

    function test_withdraw_onlyAfterTheRound_andOnlyOnce() public {
        vm.prank(alice);
        ballot.vote(3, 100e18);
        vm.prank(alice);
        vm.expectRevert(CareBallot.RoundNotOver.selector);
        ballot.withdraw(0);

        _nextRound();
        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        ballot.withdraw(0);
        assertEq(token.balanceOf(alice) - before, 100e18);
        vm.prank(alice);
        vm.expectRevert(CareBallot.NothingLocked.selector);
        ballot.withdraw(0);
    }

    function test_badOption_reverts() public {
        vm.prank(alice);
        vm.expectRevert(CareBallot.BadOption.selector);
        ballot.vote(8, 1e18);
    }

    function test_onlyTheBallotCanChangeTheAllowance() public {
        vm.expectRevert(CareVault.NotAuthorized.selector);
        vault.setMonthlyAllowance(500e8);
    }

    function test_theVaultRefusesAllowancesOutsideTheRange() public {
        vm.prank(address(ballot));
        vm.expectRevert(CareVault.InvalidConfig.selector);
        vault.setMonthlyAllowance(299e8);
        vm.prank(address(ballot));
        vm.expectRevert(CareVault.InvalidConfig.selector);
        vault.setMonthlyAllowance(1001e8);
    }

    function test_bindBallot_isDeployerOnly_once_andChecksTheVault() public {
        CareVault other = new CareVault(makeAddr("keeper"), makeAddr("rescue"), feed, 1000e8, 30 days, 2 hours);
        vm.prank(alice);
        vm.expectRevert(CareVault.NotAuthorized.selector);
        other.bindBallot(address(ballot));
        vm.expectRevert(CareVault.WrongBallot.selector);
        other.bindBallot(address(ballot)); // this ballot points at the first vault
        vm.expectRevert(CareVault.AlreadyBound.selector);
        vault.bindBallot(address(ballot));
    }
}
