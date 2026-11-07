// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

interface IBallotVault {
    function vault() external view returns (address);
}

/// @title CareVault
/// @notice Holds the money that pays Squeektoshi's keeper.
///
/// Fixed in code, with no owner and no setters:
///   - the vault holds at most one month of care (`capUsd()` = `monthlyAllowanceUsd`); the swap hook
///     only ever sends what is missing, and the rest of the fee is burned;
///   - the keeper is paid every 7 days, `monthlyAllowanceUsd * 12 / 52` a week, in ETH at the
///     Chainlink price; CARE holders vote the allowance between $300 and $1,000 a month (CareBallot);
///   - what is left at the end goes to the rescue, and from then on the vault asks for nothing, so
///     the whole fee is burned.
///
/// The keeper's money never depends on the hamster running: this contract never reads SqueekCore.
contract CareVault {
    // ---------------------------------------------------------------- constants

    /// @notice The keeper is paid at most once every 7 days.
    uint256 public constant PAYOUT_INTERVAL = 7 days;

    /// @notice Upper bound on weeks settled in one `pay()` call.
    uint256 public constant MAX_CATCHUP_WEEKS = 52;

    /// @notice If the keeper could have been paid but nobody collected for this long, anyone may
    ///         `sweep()` to the rescue.
    uint256 public constant SWEEP_SILENCE = 90 days;

    uint256 internal constant PRICE_SCALE = 1e18;

    // ---------------------------------------------------------------- immutables

    /// @notice Receives the weekly allowance.
    address public immutable keeper;

    /// @notice Receives whatever is left when the fund winds down.
    address public immutable rescue;

    /// @notice Chainlink ETH/USD feed (8 decimals).
    AggregatorV3Interface public immutable ethUsdFeed;

    /// @notice The lowest and highest monthly allowance holders can vote for, in USD with 8 decimals.
    uint256 public constant MIN_ALLOWANCE_USD = 300e8;
    uint256 public constant MAX_ALLOWANCE_USD = 1000e8;

    /// @notice Who may call `bindBallot`, once. Has no other power.
    address public immutable deployer;

    /// @notice How long the fund keeps paying after `retire()`, before `sweep()` is allowed.
    uint256 public immutable retireGrace;

    /// @notice A price older than this is rejected.
    uint256 public immutable maxPriceAge;

    // ---------------------------------------------------------------- state

    /// @notice The payout clock: every whole week up to here has been paid. It advances only by
    ///         weeks actually paid, so a week the vault could not cover is still owed.
    uint64 public paidThrough;

    /// @notice When the keeper was last actually paid (deployment time until the first payout).
    uint64 public lastPaidAt;

    /// @notice Set by `retire()`, once.
    uint64 public retiredAt;

    /// @notice Set by the first `sweep()`. From then on the vault needs nothing and the fee burns.
    bool public swept;

    /// @notice Monthly allowance in USD, 8 decimals (matches the feed). Holders set it each month
    ///         through the ballot, between `MIN_ALLOWANCE_USD` and `MAX_ALLOWANCE_USD`.
    uint256 public monthlyAllowanceUsd;

    /// @notice The CareBallot allowed to change the allowance. Bound once by the deployer.
    address public ballot;

    // ---------------------------------------------------------------- events

    event Deposited(address indexed from, uint256 amount, uint256 balance);
    event Payout(address indexed keeper, uint256 amount, uint256 weeksPaid, uint256 ethUsdPrice);
    event Retired(uint256 at);
    event Swept(address indexed rescue, uint256 amount);
    event BallotBound(address indexed ballot);
    event AllowanceChanged(uint256 previousUsd, uint256 monthlyUsd);

    // ---------------------------------------------------------------- errors

    error ZeroAddress();
    error InvalidConfig();
    error TooSoon(uint256 nextPayoutAt);
    error NothingToPay();
    error BadPrice(int256 answer);
    error StalePrice(uint256 updatedAt);
    error NotAuthorized();
    error AlreadyRetired();
    error AlreadySwept();
    error NotSweepable();
    error TransferFailed();
    error AlreadyBound();
    error WrongBallot();

    // ---------------------------------------------------------------- setup

    /// @param keeper_ Receives the weekly allowance.
    /// @param rescue_ Receives what is left after the end clause.
    /// @param ethUsdFeed_ Chainlink ETH/USD feed, 8 decimals.
    /// @param monthlyAllowanceUsd_ Monthly allowance in USD, 8 decimals.
    /// @param retireGrace_ Seconds the fund keeps paying after `retire()`.
    /// @param maxPriceAge_ Maximum accepted age of the ETH/USD price, in seconds.
    constructor(
        address keeper_,
        address rescue_,
        AggregatorV3Interface ethUsdFeed_,
        uint256 monthlyAllowanceUsd_,
        uint256 retireGrace_,
        uint256 maxPriceAge_
    ) {
        if (keeper_ == address(0) || rescue_ == address(0) || address(ethUsdFeed_) == address(0)) {
            revert ZeroAddress();
        }
        // The hook asks this vault for its shortfall on every swap, and that read goes to the feed.
        // A feed address with no code would make every price "unusable" for good.
        if (address(ethUsdFeed_).code.length == 0) revert InvalidConfig();
        if (monthlyAllowanceUsd_ < MIN_ALLOWANCE_USD || monthlyAllowanceUsd_ > MAX_ALLOWANCE_USD) {
            revert InvalidConfig();
        }
        if (maxPriceAge_ == 0 || maxPriceAge_ > 24 hours) revert InvalidConfig();

        keeper = keeper_;
        rescue = rescue_;
        ethUsdFeed = ethUsdFeed_;
        monthlyAllowanceUsd = monthlyAllowanceUsd_;
        deployer = msg.sender;
        retireGrace = retireGrace_;
        maxPriceAge = maxPriceAge_;
        paidThrough = uint64(block.timestamp);
        lastPaidAt = uint64(block.timestamp);
    }

    // ---------------------------------------------------------------- money in

    /// @notice The hook pays the fee straight in, and anyone can donate.
    /// @dev Never reverts. A vault that could reject a transfer could break the swap paying it.
    receive() external payable {
        _deposit();
    }

    /// @notice Same as sending ETH to the contract, but explicit for donors.
    function donate() external payable {
        _deposit();
    }

    function _deposit() internal {
        if (msg.value == 0) return;
        emit Deposited(msg.sender, msg.value, address(this).balance);
    }

    // ---------------------------------------------------------------- keeper payout

    /// @notice Pay the keeper every whole week that has passed. Anyone may call it; the money only
    ///         ever goes to `keeper`.
    /// @dev Pays at most what the vault holds and only advances the clock for weeks actually paid,
    ///      so a week that could not be covered is settled by a later call.
    /// @return amount ETH sent to the keeper.
    /// @return weeksPaid Number of whole weeks settled.
    function pay() external returns (uint256 amount, uint256 weeksPaid) {
        if (swept) revert AlreadySwept();

        uint256 owed = _weeksOwed();
        if (owed == 0) revert TooSoon(paidThrough + PAYOUT_INTERVAL);

        uint256 price = _price();
        uint256 perWeek = _weekEth(price);
        if (perWeek == 0) revert NothingToPay();

        uint256 affordable = address(this).balance / perWeek;
        weeksPaid = owed < affordable ? owed : affordable;
        if (weeksPaid == 0) revert NothingToPay();
        amount = weeksPaid * perWeek;

        // effects before the transfer
        paidThrough = uint64(paidThrough + weeksPaid * PAYOUT_INTERVAL);
        lastPaidAt = uint64(block.timestamp);

        (bool ok,) = keeper.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Payout(keeper, amount, weeksPaid, price);
    }

    // ---------------------------------------------------------------- the holders' vote

    /// @notice Link the ballot, once. It must already point at this vault.
    function bindBallot(address ballot_) external {
        if (msg.sender != deployer) revert NotAuthorized();
        if (ballot != address(0)) revert AlreadyBound();
        if (ballot_.code.length == 0 || IBallotVault(ballot_).vault() != address(this)) revert WrongBallot();
        ballot = ballot_;
        emit BallotBound(ballot_);
    }

    /// @notice The ballot sets the monthly allowance from a finished vote. The weekly payout and the
    ///         vault's one-month cap follow it.
    function setMonthlyAllowance(uint256 usd) external {
        if (msg.sender != ballot || ballot == address(0)) revert NotAuthorized();
        if (usd < MIN_ALLOWANCE_USD || usd > MAX_ALLOWANCE_USD) revert InvalidConfig();
        emit AllowanceChanged(monthlyAllowanceUsd, usd);
        monthlyAllowanceUsd = usd;
    }

    // ---------------------------------------------------------------- end clause

    /// @notice Start winding down. Only the keeper or the rescue can do this.
    function retire() external {
        if (msg.sender != keeper && msg.sender != rescue) revert NotAuthorized();
        if (retiredAt != 0) revert AlreadyRetired();
        retiredAt = uint64(block.timestamp);
        emit Retired(block.timestamp);
    }

    /// @notice Send everything the vault holds to the rescue. Anyone may call it.
    ///
    /// The first sweep is allowed once the fund has retired and its grace period has passed, or once
    /// the vault has held at least a week's allowance for 90 days with nobody collecting it. After
    /// that the fund is closed: `pay()` stops, the hook sends nothing more here, and any ETH that
    /// still arrives (a late donation) can be swept again.
    /// @return amount ETH sent to the rescue.
    function sweep() external returns (uint256 amount) {
        if (!swept) {
            bool graceElapsed = retiredAt != 0 && block.timestamp >= retiredAt + retireGrace;
            if (!graceElapsed && !_abandoned()) revert NotSweepable();
            swept = true;
        }

        amount = address(this).balance;
        if (amount > 0) {
            (bool ok,) = rescue.call{value: amount}("");
            if (!ok) revert TransferFailed();
        }
        emit Swept(rescue, amount);
    }

    // ---------------------------------------------------------------- views

    /// @notice One month of care: the most the vault ever asks the hook for.
    function capUsd() public view returns (uint256) {
        return monthlyAllowanceUsd;
    }

    /// @notice Weekly allowance in USD, 8 decimals.
    function weeklyAllowanceUsd() public view returns (uint256) {
        return (monthlyAllowanceUsd * 12) / 52;
    }

    /// @notice Timestamp the next weekly payout unlocks.
    function nextPayoutAt() external view returns (uint256) {
        return paidThrough + PAYOUT_INTERVAL;
    }

    /// @notice Whole weeks currently owed to the keeper (before the balance cap).
    function weeksOwed() external view returns (uint256) {
        return _weeksOwed();
    }

    /// @notice ETH the vault holds, in USD (8 decimals). Reverts if the price is unusable.
    function vaultUsd() external view returns (uint256) {
        return _toUsd(address(this).balance, _price());
    }

    /// @notice True when the vault holds at least one month of care. Reverts if the price is unusable.
    function isFunded() external view returns (bool) {
        return _toUsd(address(this).balance, _price()) >= capUsd();
    }

    /// @notice ETH the vault still needs to hold a full month of care. The hook reads this on every
    ///         swap: it sends the vault this much of the fee and burns the rest.
    /// @dev Never reverts, because it is read inside swaps.
    ///      - Once swept, the fund is closed and needs nothing: returns 0, so every fee burns.
    ///      - With an unusable price it cannot know the gap, so it returns `type(uint256).max`
    ///        ("care needs all of it"). A feed outage can never divert money away from care.
    function careShortfallEth() external view returns (uint256) {
        if (swept) return 0;
        (uint256 price, bool ok) = _tryPrice();
        if (!ok) return type(uint256).max;

        uint256 target = (capUsd() * PRICE_SCALE) / price;
        uint256 balance = address(this).balance;
        return balance >= target ? 0 : target - balance;
    }

    /// @notice The cap in ETH at the live price, or 0 when the price cannot be read.
    function capEth() external view returns (uint256) {
        (uint256 price, bool ok) = _tryPrice();
        if (!ok) return 0;
        return (capUsd() * PRICE_SCALE) / price;
    }

    /// @notice One call for dashboards. Never reverts; `priceOk` says whether the price was usable,
    ///         and every price-dependent field is 0 when it was not.
    function preview()
        external
        view
        returns (
            uint256 balance,
            uint256 balanceUsd,
            bool priceOk,
            uint256 ethUsdPrice,
            uint256 cap,
            uint256 weeklyUsd,
            uint256 weeklyEth,
            uint256 nextPayout,
            uint256 owedWeeks,
            bool closed
        )
    {
        balance = address(this).balance;
        (uint256 price, bool ok) = _tryPrice();
        priceOk = ok;
        ethUsdPrice = price;
        balanceUsd = ok ? _toUsd(balance, price) : 0;
        cap = capUsd();
        weeklyUsd = weeklyAllowanceUsd();
        weeklyEth = ok ? _weekEth(price) : 0;
        nextPayout = paidThrough + PAYOUT_INTERVAL;
        owedWeeks = _weeksOwed();
        closed = swept;
    }

    // ---------------------------------------------------------------- internals

    function _weeksOwed() internal view returns (uint256) {
        uint256 owed = (block.timestamp - paidThrough) / PAYOUT_INTERVAL;
        return owed > MAX_CATCHUP_WEEKS ? MAX_CATCHUP_WEEKS : owed;
    }

    function _weekEth(uint256 price) internal view returns (uint256) {
        return (weeklyAllowanceUsd() * PRICE_SCALE) / price;
    }

    /// @dev "Nobody is collecting": 90 days since the keeper was last paid, while the vault holds
    ///      at least one week's allowance, so a payout was possible the whole time anyone checked.
    ///      A vault too poor to pay is never "abandoned" - slow trading cannot be used to close it.
    function _abandoned() internal view returns (bool) {
        if (block.timestamp < lastPaidAt + SWEEP_SILENCE) return false;
        (uint256 price, bool ok) = _tryPrice();
        if (!ok) return false;
        return address(this).balance >= _weekEth(price);
    }

    function _toUsd(uint256 ethAmount, uint256 price) internal pure returns (uint256) {
        return (ethAmount * price) / PRICE_SCALE;
    }

    function _price() internal view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = ethUsdFeed.latestRoundData();
        if (answer <= 0) revert BadPrice(answer);
        if (updatedAt == 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > maxPriceAge) {
            revert StalePrice(updatedAt);
        }
        return uint256(answer);
    }

    function _tryPrice() internal view returns (uint256 price, bool ok) {
        try ethUsdFeed.latestRoundData() returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80) {
            if (
                answer > 0 && updatedAt != 0 && updatedAt <= block.timestamp
                    && block.timestamp - updatedAt <= maxPriceAge
            ) {
                return (uint256(answer), true);
            }
        } catch {}
        return (0, false);
    }
}
