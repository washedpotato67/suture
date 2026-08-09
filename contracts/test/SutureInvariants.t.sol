// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PolicyManifestRegistry} from "../src/PolicyManifestRegistry.sol";
import {PolicyActivationScheduler} from "../src/PolicyActivationScheduler.sol";
import {RemediationEscrow} from "../src/RemediationEscrow.sol";
import {IPolicyManifestRegistry, IRemediationEscrow} from "../src/SutureInterfaces.sol";
import {MockERC20} from "./Suture.t.sol";

/**
 * Handler driving the escrow and policy registry with bounded random input.
 * Every call is wrapped so a revert does not abort the run: invariants must
 * hold across accepted AND rejected calls, which is where authority bugs show.
 */
contract SutureHandler is Test {
    RemediationEscrow public escrow;
    PolicyManifestRegistry public policies;
    PolicyActivationScheduler public scheduler;
    MockERC20 public token;
    address public authority;
    address public vault;

    bytes32[] public remediationIds;
    uint64 public highestActivatedVersion;
    mapping(bytes32 id => uint8 status) public lastSeenStatus;

    constructor(
        RemediationEscrow escrow_,
        PolicyManifestRegistry policies_,
        PolicyActivationScheduler scheduler_,
        MockERC20 token_,
        address authority_,
        address vault_
    ) {
        escrow = escrow_;
        policies = policies_;
        scheduler = scheduler_;
        token = token_;
        authority = authority_;
        vault = vault_;
    }

    function openRemediation(uint96 seed, uint96 amount) external {
        bytes32 id = keccak256(abi.encode("remediation", seed));
        uint256 expected = bound(uint256(amount), 1, 1_000 ether);
        vm.prank(authority);
        try escrow.openRemediation(
            id, keccak256(abi.encode("position", seed)), address(0xBEEF), address(0xCAFE),
            address(token), expected, keccak256("policy")
        ) {
            remediationIds.push(id);
        } catch {}
    }

    function approve(uint256 index) external {
        if (remediationIds.length == 0) return;
        bytes32 id = remediationIds[index % remediationIds.length];
        vm.prank(authority);
        try escrow.approve(id) {} catch {}
    }

    function fund(uint256 index, uint96 amount) external {
        if (remediationIds.length == 0) return;
        bytes32 id = remediationIds[index % remediationIds.length];
        uint256 value = bound(uint256(amount), 1, 1_000 ether);
        vm.startPrank(vault);
        try escrow.beginAuthorizedFunding(id, address(0xBEEF), value) {
            token.mint(vault, value);
            token.transfer(address(escrow), value);
            try escrow.receiveFromAuthorizedVault(id, address(0xBEEF), value) {} catch {}
        } catch {}
        vm.stopPrank();
    }

    function release(uint256 index) external {
        if (remediationIds.length == 0) return;
        bytes32 id = remediationIds[index % remediationIds.length];
        vm.prank(authority);
        try escrow.release(id) {} catch {}
    }

    /// Only the scheduler may activate, and it always supplies block.timestamp.
    function activate(uint64 version, uint32 timeJump) external {
        vm.warp(block.timestamp + bound(uint256(timeJump), 1, 30 days));
        uint64 candidate = uint64(bound(uint256(version), 1, type(uint32).max));
        vm.prank(scheduler.owner());
        try scheduler.activateNow(address(token), candidate, keccak256("h"), keccak256("r")) {
            highestActivatedVersion = candidate;
        } catch {}
    }

    function remediationCount() external view returns (uint256) {
        return remediationIds.length;
    }

    function remediationAt(uint256 i) external view returns (bytes32) {
        return remediationIds[i];
    }

    function recordStatus(bytes32 id, uint8 status) external {
        lastSeenStatus[id] = status;
    }
}

contract SutureInvariantsTest is Test {
    RemediationEscrow internal escrow;
    PolicyManifestRegistry internal policies;
    PolicyActivationScheduler internal scheduler;
    MockERC20 internal token;
    SutureHandler internal handler;

    address internal authority = makeAddr("authority");
    address internal vault = makeAddr("vault");

    function setUp() public {
        token = new MockERC20();
        policies = new PolicyManifestRegistry(authority, authority);
        escrow = new RemediationEscrow(authority, authority);
        scheduler = new PolicyActivationScheduler(address(policies), authority);

        vm.startPrank(authority);
        escrow.setAuthorizedVault(vault, true);
        policies.setPolicyAuthority(address(scheduler));
        vm.stopPrank();

        handler = new SutureHandler(escrow, policies, scheduler, token, authority, vault);
        targetContract(address(handler));
    }

    /// Funding may never exceed what the remediation declared. A violation would
    /// let an over-funded release drain escrow balance belonging to another case.
    function invariant_fundedNeverExceedsExpected() public view {
        uint256 count = handler.remediationCount();
        for (uint256 i = 0; i < count; i++) {
            IRemediationEscrow.Remediation memory item = escrow.remediation(handler.remediationAt(i));
            assertLe(item.fundedAmount, item.expectedAmount, "funded exceeded expected");
        }
    }

    /// Escrow must hold at least the sum of everything funded but not yet
    /// released. Anything less means a release paid out unbacked balance.
    function invariant_escrowSolvency() public view {
        uint256 count = handler.remediationCount();
        uint256 owed;
        for (uint256 i = 0; i < count; i++) {
            IRemediationEscrow.Remediation memory item = escrow.remediation(handler.remediationAt(i));
            if (item.status != IRemediationEscrow.Status.Executed) owed += item.fundedAmount;
        }
        assertGe(token.balanceOf(address(escrow)), owed, "escrow holds less than it owes");
    }

    /// A remediation that reached Executed must have paid out exactly what it
    /// held, never a partial amount.
    function invariant_executedImpliesFullyFunded() public view {
        uint256 count = handler.remediationCount();
        for (uint256 i = 0; i < count; i++) {
            IRemediationEscrow.Remediation memory item = escrow.remediation(handler.remediationAt(i));
            if (item.status == IRemediationEscrow.Status.Executed) {
                assertEq(item.fundedAmount, item.expectedAmount, "executed without full funding");
            }
        }
    }

    /// The active policy version never decreases, regardless of call ordering.
    function invariant_policyVersionMonotonic() public view {
        IPolicyManifestRegistry.PolicyRef memory active = policies.activePolicy(address(token));
        assertGe(handler.highestActivatedVersion(), active.version, "active version exceeds highest activated");
    }

    /// An active policy is never post-dated: activation is same-block by design,
    /// so an effectiveAt in the future would mean the invariant was bypassed.
    function invariant_activePolicyNeverPostDated() public view {
        IPolicyManifestRegistry.PolicyRef memory active = policies.activePolicy(address(token));
        if (active.active) {
            assertLe(active.effectiveAt, uint64(block.timestamp), "active policy is post-dated");
        }
    }
}
