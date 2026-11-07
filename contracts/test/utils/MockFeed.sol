// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AggregatorV3Interface} from "../../src/interfaces/AggregatorV3Interface.sol";

/// @notice Minimal Chainlink ETH/USD stand-in for tests. Same shape as the real feed.
contract MockFeed is AggregatorV3Interface {
    int256 public answer;
    uint256 public updatedAt;
    bool public alwaysRevert;

    constructor(int256 answer_, uint256 updatedAt_) {
        answer = answer_;
        updatedAt = updatedAt_;
    }

    function set(int256 answer_, uint256 updatedAt_) external {
        answer = answer_;
        updatedAt = updatedAt_;
    }

    function setPrice(int256 answer_) external {
        answer = answer_;
    }

    function setRevert(bool value) external {
        alwaysRevert = value;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function description() external pure returns (string memory) {
        return "MOCK / ETH / USD";
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!alwaysRevert, "feed down");
        return (1, answer, updatedAt, updatedAt, 1);
    }
}
