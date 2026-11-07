// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CareToken} from "../src/CareToken.sol";
import {CareAirdrop} from "../src/CareAirdrop.sol";

contract CareAirdropTest is Test {
    using stdJson for string;

    CareToken token;
    CareAirdrop airdrop;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    uint256 constant A = 3_000e18;
    uint256 constant B = 7_000e18;

    function _leaf(address account, uint256 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
    }

    function _pair(bytes32 x, bytes32 y) internal pure returns (bytes32) {
        return x < y ? keccak256(abi.encodePacked(x, y)) : keccak256(abi.encodePacked(y, x));
    }

    function setUp() public {
        token = new CareToken("Squeektoshi Care Fund", "CARE", 1_000_000_000e18, address(this));
        bytes32 root = _pair(_leaf(alice, A), _leaf(bob, B));
        airdrop = new CareAirdrop(IERC20(address(token)), root, 123, 60);
        token.transfer(address(airdrop), A + B);
    }

    function _proof(bytes32 sibling) internal pure returns (bytes32[] memory p) {
        p = new bytes32[](1);
        p[0] = sibling;
    }

    function test_claim_paysTheWalletInTheSnapshot_evenIfSomeoneElseSubmits() public {
        vm.prank(makeAddr("helper"));
        airdrop.claim(alice, A, _proof(_leaf(bob, B)));
        assertEq(token.balanceOf(alice), A);
        assertTrue(airdrop.claimed(alice));
    }

    function test_claim_once() public {
        airdrop.claim(alice, A, _proof(_leaf(bob, B)));
        vm.expectRevert(CareAirdrop.AlreadyClaimed.selector);
        airdrop.claim(alice, A, _proof(_leaf(bob, B)));
    }

    function test_claim_rejectsAWrongAmount() public {
        vm.expectRevert(CareAirdrop.InvalidProof.selector);
        airdrop.claim(alice, A + 1, _proof(_leaf(bob, B)));
    }

    function test_claimsClose_andTheRestBurns() public {
        airdrop.claim(alice, A, _proof(_leaf(bob, B)));
        vm.expectRevert(CareAirdrop.StillOpen.selector);
        airdrop.burnUnclaimed();

        vm.warp(block.timestamp + 60 days);
        vm.expectRevert(CareAirdrop.ClaimsClosed.selector);
        airdrop.claim(bob, B, _proof(_leaf(alice, A)));

        airdrop.burnUnclaimed();
        assertEq(token.balanceOf(0x000000000000000000000000000000000000dEaD), B);
        assertEq(token.balanceOf(address(airdrop)), 0);
    }

    /// @dev The real snapshot (backend/data/airdrop.json, built by backend/scripts/snapshot.mjs)
    ///      must use the same leaf format as the contract: check a few of its proofs on chain.
    function test_theRealSnapshotProofsVerify() public {
        string memory path = "../backend/data/airdrop.json";
        string memory json;
        try vm.readFile(path) returns (string memory j) {
            json = j;
        } catch {
            vm.skip(true);
            return;
        }
        bytes32 root = json.readBytes32(".root");
        CareAirdrop real = new CareAirdrop(IERC20(address(token)), root, 1, 60);
        token.transfer(address(real), 70_000_000e18);

        string[] memory accounts = vm.parseJsonKeys(json, ".claims");
        assertGt(accounts.length, 0);
        uint256 checks = accounts.length < 5 ? accounts.length : 5;
        for (uint256 i; i < checks; i++) {
            string memory key = string.concat(".claims.", accounts[i]);
            address account = vm.parseAddress(accounts[i]);
            uint256 amount = vm.parseUint(json.readString(string.concat(key, ".amount")));
            bytes32[] memory proof = json.readBytes32Array(string.concat(key, ".proof"));
            real.claim(account, amount, proof);
            assertEq(token.balanceOf(account), amount);
        }
    }
}
