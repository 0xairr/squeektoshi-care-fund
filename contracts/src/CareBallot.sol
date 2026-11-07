// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface ICareVaultAllowance {
    function setMonthlyAllowance(uint256 usd) external;
}

/// @title CareBallot
/// @notice CARE holders vote each 30-day round on Squeektoshi's monthly allowance: $300 to $1,000 in
///         steps of $100. You vote by locking CARE for the round; the CARE comes back once the round
///         is over. The result is the weighted median of the votes, so one large holder choosing an
///         extreme cannot drag it there. Anyone can enact a finished round, which sets the vault's
///         allowance (and with it the weekly payout and the vault's cap) for the time after.
///
/// No owner and no setters. The 5% swap fee is not up for a vote.
contract CareBallot {
    using SafeERC20 for IERC20;

    uint256 public constant ROUND = 30 days;
    uint256 public constant MIN_USD = 300;
    uint256 public constant STEP_USD = 100;
    uint256 public constant OPTIONS = 8; // $300, $400, ... $1,000

    IERC20 public immutable token;
    ICareVaultAllowance public immutable vault;
    uint256 public immutable start;

    /// @dev round => option => CARE locked behind it
    mapping(uint256 => uint256[8]) internal _weights;
    /// @notice round => voter => CARE locked
    mapping(uint256 => mapping(address => uint256)) public locked;
    /// @dev round => voter => option + 1 (0 = has not voted)
    mapping(uint256 => mapping(address => uint8)) internal _choice;
    /// @notice The round whose result was last enacted, plus one (0 = none yet).
    uint256 public enactedThrough;

    event Voted(uint256 indexed round, address indexed voter, uint8 option, uint256 locked);
    event Withdrawn(uint256 indexed round, address indexed voter, uint256 amount);
    event Enacted(uint256 indexed round, uint256 monthlyUsd, uint256 totalLocked);

    error BadOption();
    error NothingLocked();
    error RoundNotOver();
    error AlreadyEnacted();

    constructor(IERC20 token_, ICareVaultAllowance vault_) {
        require(address(token_).code.length > 0 && address(vault_).code.length > 0, "bad wiring");
        token = token_;
        vault = vault_;
        start = block.timestamp;
    }

    // ---------------------------------------------------------------- views

    function currentRound() public view returns (uint256) {
        return (block.timestamp - start) / ROUND;
    }

    function roundEnds(uint256 round) external view returns (uint256) {
        return start + (round + 1) * ROUND;
    }

    /// @notice The monthly allowance an option stands for, in whole dollars.
    function optionUsd(uint8 option) public pure returns (uint256) {
        return MIN_USD + uint256(option) * STEP_USD;
    }

    function weights(uint256 round) external view returns (uint256[8] memory) {
        return _weights[round];
    }

    /// @notice What `voter` chose in `round`, and whether they voted at all.
    function choiceOf(uint256 round, address voter) external view returns (uint8 option, bool voted) {
        uint8 c = _choice[round][voter];
        return (c == 0 ? 0 : c - 1, c != 0);
    }

    /// @notice The weighted median of a round: the lowest option that at least half the locked CARE
    ///         voted for or below. Zero dollars if nobody voted.
    function result(uint256 round) public view returns (uint256 monthlyUsd, uint256 totalLocked) {
        uint256[8] storage w = _weights[round];
        for (uint256 i; i < OPTIONS; ++i) {
            totalLocked += w[i];
        }
        if (totalLocked == 0) return (0, 0);
        uint256 running;
        for (uint256 i; i < OPTIONS; ++i) {
            running += w[i];
            if (running * 2 >= totalLocked) return (optionUsd(uint8(i)), totalLocked);
        }
    }

    // ---------------------------------------------------------------- voting

    /// @notice Vote in the current round, locking `amount` more CARE (approve this contract first).
    ///         Calling again adds to your lock and moves all of it to the new option.
    function vote(uint8 option, uint256 amount) external {
        if (option >= OPTIONS) revert BadOption();
        uint256 round = currentRound();
        if (amount > 0) token.safeTransferFrom(msg.sender, address(this), amount);

        uint256 before = locked[round][msg.sender];
        uint256 total = before + amount;
        if (total == 0) revert NothingLocked();

        uint8 previous = _choice[round][msg.sender];
        if (previous != 0) _weights[round][previous - 1] -= before;
        _weights[round][option] += total;
        locked[round][msg.sender] = total;
        _choice[round][msg.sender] = option + 1;
        emit Voted(round, msg.sender, option, total);
    }

    /// @notice Take back the CARE you locked in a round that is over.
    function withdraw(uint256 round) external {
        if (round >= currentRound()) revert RoundNotOver();
        uint256 amount = locked[round][msg.sender];
        if (amount == 0) revert NothingLocked();
        locked[round][msg.sender] = 0;
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(round, msg.sender, amount);
    }

    /// @notice Set the vault's allowance from a finished round. Anyone can call it. Rounds are enacted
    ///         in order and once each; a round with no votes leaves the allowance as it is.
    function enact(uint256 round) external {
        if (round >= currentRound()) revert RoundNotOver();
        if (round < enactedThrough) revert AlreadyEnacted();
        enactedThrough = round + 1;
        (uint256 usd, uint256 total) = result(round);
        if (total > 0) vault.setMonthlyAllowance(usd * 1e8);
        emit Enacted(round, usd, total);
    }
}
