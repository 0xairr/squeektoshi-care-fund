// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title CareToken
/// @notice A plain ERC-20 with a fixed supply, minted once at deployment.
///
/// No owner, no minting after construction, no transfer fee, no blacklist, no pausing. The care fee
/// does not live in this token - it lives in the pool hook, so it applies to the pool and cannot be
/// changed from here.
contract CareToken is ERC20 {
    error ZeroRecipient();

    /// @param name_ Token name.
    /// @param symbol_ Token symbol.
    /// @param supply Total supply, minted once to `recipient`.
    /// @param recipient Who receives the whole supply (the pool's liquidity provider).
    constructor(string memory name_, string memory symbol_, uint256 supply, address recipient) ERC20(name_, symbol_) {
        if (recipient == address(0)) revert ZeroRecipient();
        _mint(recipient, supply);
    }
}
