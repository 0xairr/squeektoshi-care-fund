// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title CareAirdrop
/// @notice 7% of CARE for Squeek Genesis holders, from a snapshot (see backend/scripts/snapshot.mjs).
///         Each wallet claims its amount once with a Merkle proof; anyone may submit the claim, and the
///         tokens always go to the wallet in the snapshot. After the deadline anything unclaimed can be
///         sent to the burn address by anyone.
///
/// The snapshot counts a Squeek for every Squeek merged into it (2^(level-1)), and a staked Squeek for
/// the wallet that staked it. No owner and no setters.
contract CareAirdrop {
    using SafeERC20 for IERC20;

    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    IERC20 public immutable token;
    bytes32 public immutable merkleRoot;
    uint256 public immutable snapshotBlock;
    uint256 public immutable deadline;

    mapping(address => bool) public claimed;

    event Claimed(address indexed account, uint256 amount);
    event UnclaimedBurned(uint256 amount);

    error ClaimsClosed();
    error AlreadyClaimed();
    error InvalidProof();
    error StillOpen();

    constructor(IERC20 token_, bytes32 merkleRoot_, uint256 snapshotBlock_, uint256 claimDays) {
        require(address(token_).code.length > 0 && merkleRoot_ != bytes32(0), "bad wiring");
        require(claimDays > 0 && claimDays <= 365, "bad window");
        token = token_;
        merkleRoot = merkleRoot_;
        snapshotBlock = snapshotBlock_;
        deadline = block.timestamp + claimDays * 1 days;
    }

    /// @notice Claim `amount` for `account`. The leaf is the OpenZeppelin standard Merkle tree leaf of
    ///         (address, uint256).
    function claim(address account, uint256 amount, bytes32[] calldata proof) external {
        if (block.timestamp >= deadline) revert ClaimsClosed();
        if (claimed[account]) revert AlreadyClaimed();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
        if (!MerkleProof.verifyCalldata(proof, merkleRoot, leaf)) revert InvalidProof();
        claimed[account] = true;
        token.safeTransfer(account, amount);
        emit Claimed(account, amount);
    }

    /// @notice After the deadline, send whatever is left to the burn address. Anyone can call it.
    function burnUnclaimed() external returns (uint256 amount) {
        if (block.timestamp < deadline) revert StillOpen();
        amount = token.balanceOf(address(this));
        if (amount > 0) token.safeTransfer(BURN_ADDRESS, amount);
        emit UnclaimedBurned(amount);
    }
}
