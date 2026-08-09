// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";

import {
    IERC20Minimal,
    IEligibilityOracle,
    IPolicyManifestRegistry,
    IPositionLineageRegistry,
    IRemediationEscrow
} from "../src/SutureInterfaces.sol";
import {PolicyManifestRegistry} from "../src/PolicyManifestRegistry.sol";
import {PositionLineageRegistry} from "../src/PositionLineageRegistry.sol";
import {BoundVault} from "../src/BoundVault.sol";
import {MockCreditMarket} from "../src/MockCreditMarket.sol";
import {RemediationEscrow} from "../src/RemediationEscrow.sol";

contract MockERC20 is IERC20Minimal {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] >= amount) allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockEligibilityOracle is IEligibilityOracle {
    mapping(address => bool) public walletAllowed;
    mapping(bytes4 => bool) public actionAllowed;

    constructor() {
        walletAllowed[address(0)] = true;
    }

    function setWalletAllowed(address wallet, bool allowed) external {
        walletAllowed[wallet] = allowed;
    }

    function setActionAllowed(bytes4 action, bool allowed) external {
        actionAllowed[action] = allowed;
    }

    function mayPerform(address wallet, address, bytes4 action) external view returns (bool) {
        return walletAllowed[wallet] && actionAllowed[action];
    }
}

contract SutureTest is Test {
    address issuer = makeAddr("issuer");
    address policyAuthority = makeAddr("policyAuthority");
    address approver = makeAddr("approver");
    address alice = makeAddr("alice");
    address replacement = makeAddr("replacement");
    address stranger = makeAddr("stranger");

    MockERC20 token;
    MockEligibilityOracle oracle;
    PolicyManifestRegistry policies;
    PositionLineageRegistry lineage;
    BoundVault vault;
    MockCreditMarket market;
    RemediationEscrow escrow;

    bytes32 constant SOURCE_POSITION = keccak256("source-position");
    bytes32 constant TX_DEPOSIT = keccak256("tx-deposit");
    bytes32 constant EVIDENCE = keccak256("evidence");

    function setUp() public {
        token = new MockERC20();
        oracle = new MockEligibilityOracle();
        policies = new PolicyManifestRegistry(issuer, policyAuthority);
        lineage = new PositionLineageRegistry(policyAuthority);
        vault = new BoundVault(policyAuthority, address(token), address(oracle), address(policies), address(lineage));
        market = new MockCreditMarket(address(vault), address(oracle), address(policies), address(lineage));
        escrow = new RemediationEscrow(policyAuthority, approver);

        vm.startPrank(policyAuthority);
        lineage.setRecorder(address(vault), true);
        lineage.setRecorder(address(market), true);
        vault.setAuthorizedMarket(address(market), true);
        vault.setRemediationEscrow(address(escrow));
        escrow.setAuthorizedVault(address(vault), true);
        policies.activatePolicy(address(token), 1, keccak256("policy-v1"), keccak256("policy-reference-v1"), uint64(block.timestamp));
        vm.stopPrank();

        oracle.setWalletAllowed(alice, true);
        oracle.setWalletAllowed(replacement, true);
        oracle.setActionAllowed(vault.deposit.selector, true);
        oracle.setActionAllowed(vault.redeemRestricted.selector, true);
        oracle.setActionAllowed(vault.fundAuthorizedRemediation.selector, true);
        oracle.setActionAllowed(vault.lockForCollateral.selector, true);
        oracle.setActionAllowed(market.collateralize.selector, true);
        oracle.setActionAllowed(market.borrow.selector, true);

        token.mint(alice, 1_000 ether);
        vm.prank(alice);
        token.approve(address(vault), type(uint256).max);
    }

    function _deposit(uint256 amount) internal returns (bytes32) {
        vm.prank(alice);
        return vault.deposit(amount, alice, SOURCE_POSITION, TX_DEPOSIT, EVIDENCE);
    }

    function test_policyStoresImmutableHistoryAndAuthorityControlsActivation() public {
        vm.prank(policyAuthority);
        policies.activatePolicy(address(token), 2, keccak256("policy-v2"), keccak256("policy-reference-v2"), uint64(block.timestamp));

        IPolicyManifestRegistry.PolicyRef memory historical = policies.policyVersion(address(token), 1);
        IPolicyManifestRegistry.PolicyRef memory active = policies.activePolicy(address(token));
        assertEq(historical.version, 1);
        assertEq(active.version, 2);
        assertEq(historical.policyHash, keccak256("policy-v1"));

        vm.prank(stranger);
        vm.expectRevert(PolicyManifestRegistry.Unauthorized.selector);
        policies.activatePolicy(address(token), 3, keccak256("policy-v3"), keccak256("policy-reference-v3"), uint64(block.timestamp));
    }

    function test_policyRejectsPastAndNonMonotonicActivation() public {
        vm.prank(policyAuthority);
        vm.expectRevert(PolicyManifestRegistry.InvalidEffectiveTime.selector);
        policies.activatePolicy(address(token), 2, keccak256("policy-v2"), keccak256("ref-v2"), uint64(block.timestamp - 1));

        vm.prank(policyAuthority);
        vm.expectRevert(PolicyManifestRegistry.NonMonotonicVersion.selector);
        policies.activatePolicy(address(token), 1, keccak256("policy-v1b"), keccak256("ref-v1b"), uint64(block.timestamp));
    }

    function test_policyRejectsFutureActivationUntilAnAuthorizedSchedulerExists() public {
        vm.prank(policyAuthority);
        vm.expectRevert(PolicyManifestRegistry.InvalidEffectiveTime.selector);
        policies.activatePolicy(address(token), 2, keccak256("policy-v2"), keccak256("ref-v2"), uint64(block.timestamp + 1));
    }

    function test_fullCompositionRecordsThreeTraceableLineageEdges() public {
        bytes32 receipt = _deposit(100 ether);
        vm.prank(alice);
        bytes32 collateral = market.collateralize(receipt, 80 ether, keccak256("tx-collateral"), EVIDENCE);
        vm.prank(alice);
        bytes32 debt = market.borrow(collateral, 50 ether, keccak256("tx-borrow"), EVIDENCE);

        IPositionLineageRegistry.LineageEdge memory vaultEdge = lineage.lineage(
            keccak256(abi.encode("vault_deposit", receipt, TX_DEPOSIT))
        );
        IPositionLineageRegistry.LineageEdge memory collateralEdge = lineage.lineage(
            keccak256(abi.encode("collateralize", collateral, keccak256("tx-collateral")))
        );
        IPositionLineageRegistry.LineageEdge memory debtEdge = lineage.lineage(
            keccak256(abi.encode("borrow", debt, keccak256("tx-borrow")))
        );
        assertEq(vaultEdge.sourcePositionId, SOURCE_POSITION);
        assertEq(vaultEdge.derivedPositionId, receipt);
        assertEq(collateralEdge.sourcePositionId, receipt);
        assertEq(collateralEdge.derivedPositionId, collateral);
        assertEq(debtEdge.sourcePositionId, collateral);
        assertEq(debtEdge.derivedPositionId, debt);
        assertEq(debtEdge.owner, alice);
        assertEq(uint8(debtEdge.evidenceState), uint8(IPositionLineageRegistry.EvidenceState.Asserted));
    }

    function test_revokedCredentialBlocksDepositAndBorrow() public {
        oracle.setWalletAllowed(alice, false);
        vm.prank(alice);
        vm.expectRevert(BoundVault.Ineligible.selector);
        vault.deposit(100 ether, alice, SOURCE_POSITION, TX_DEPOSIT, EVIDENCE);

        oracle.setWalletAllowed(alice, true);
        bytes32 receipt = _deposit(100 ether);
        vm.prank(alice);
        bytes32 collateral = market.collateralize(receipt, 80 ether, keccak256("tx-collateral"), EVIDENCE);
        oracle.setWalletAllowed(alice, false);
        vm.prank(alice);
        vm.expectRevert(MockCreditMarket.Ineligible.selector);
        market.borrow(collateral, 50 ether, keccak256("tx-borrow"), EVIDENCE);
    }

    function test_changedPolicyBlocksNewRiskButAllowsRestrictedExit() public {
        bytes32 receipt = _deposit(100 ether);
        vm.prank(policyAuthority);
        policies.activatePolicy(address(token), 2, keccak256("policy-v2"), keccak256("policy-reference-v2"), uint64(block.timestamp));

        vm.prank(alice);
        vm.expectRevert(BoundVault.PolicyBlocked.selector);
        market.collateralize(receipt, 80 ether, keccak256("tx-collateral"), EVIDENCE);

        vm.prank(alice);
        vault.redeemRestricted(receipt, 100 ether, replacement, keccak256("tx-exit"));
        assertEq(token.balanceOf(replacement), 100 ether);
    }

    function test_emergencyExitOnlyBlocksDepositButPermitsExit() public {
        bytes32 receipt = _deposit(100 ether);
        vm.prank(issuer);
        policies.setEmergencyStatus(address(token), IPolicyManifestRegistry.EmergencyStatus.ExitOnly);

        vm.prank(alice);
        vm.expectRevert(BoundVault.PolicyBlocked.selector);
        vault.deposit(10 ether, alice, SOURCE_POSITION, keccak256("tx-new-deposit"), EVIDENCE);

        vm.prank(alice);
        vault.redeemRestricted(receipt, 100 ether, replacement, keccak256("tx-exit"));
        assertEq(token.balanceOf(replacement), 100 ether);
    }

    function test_lineageRejectsUnauthorizedAndDuplicateEvents() public {
        bytes32 edgeId = keccak256("edge");
        vm.prank(stranger);
        vm.expectRevert(PositionLineageRegistry.Unauthorized.selector);
        lineage.recordLineage(edgeId, SOURCE_POSITION, keccak256("derived"), alice, 1, keccak256("tx"), EVIDENCE, IPositionLineageRegistry.EvidenceState.Asserted);

        vm.prank(policyAuthority);
        lineage.setRecorder(policyAuthority, true);
        vm.prank(policyAuthority);
        lineage.recordLineage(edgeId, SOURCE_POSITION, keccak256("derived"), alice, 1, keccak256("tx"), EVIDENCE, IPositionLineageRegistry.EvidenceState.Asserted);
        vm.prank(policyAuthority);
        vm.expectRevert(PositionLineageRegistry.LineageAlreadyRecorded.selector);
        lineage.recordLineage(edgeId, SOURCE_POSITION, keccak256("derived"), alice, 1, keccak256("tx"), EVIDENCE, IPositionLineageRegistry.EvidenceState.Asserted);
    }

    function test_authorizedUserFundsAndAuthorityReleasesRemediation() public {
        bytes32 receipt = _deposit(100 ether);
        bytes32 remediationId = keccak256("remediation");
        vm.prank(policyAuthority);
        escrow.openRemediation(remediationId, receipt, alice, replacement, address(token), 100 ether, keccak256("policy-v1"));
        vm.prank(approver);
        escrow.approve(remediationId);

        vm.prank(alice);
        vault.fundAuthorizedRemediation(remediationId, receipt, 100 ether, keccak256("tx-remediation"));
        assertEq(token.balanceOf(address(escrow)), 100 ether);
        assertEq(uint8(escrow.remediation(remediationId).status), uint8(IRemediationEscrow.Status.Funded));

        vm.prank(stranger);
        vm.expectRevert(RemediationEscrow.Unauthorized.selector);
        escrow.release(remediationId);
        vm.prank(policyAuthority);
        escrow.release(remediationId);
        assertEq(token.balanceOf(replacement), 100 ether);

        vm.prank(policyAuthority);
        vm.expectRevert(RemediationEscrow.InvalidStatus.selector);
        escrow.release(remediationId);
    }

    function test_revokedSourceCanFundAuthorizedRemediationForEligibleReplacement() public {
        bytes32 receipt = _deposit(100 ether);
        bytes32 remediationId = keccak256("revoked-remediation");
        vm.prank(policyAuthority);
        escrow.openRemediation(remediationId, receipt, alice, replacement, address(token), 100 ether, keccak256("policy-v1"));
        vm.prank(approver);
        escrow.approve(remediationId);
        oracle.setWalletAllowed(alice, false);

        vm.prank(alice);
        vault.fundAuthorizedRemediation(remediationId, receipt, 100 ether, keccak256("tx-recovery"));
        vm.prank(policyAuthority);
        escrow.release(remediationId);
        assertEq(token.balanceOf(replacement), 100 ether);
    }

    function test_remediationRequiresEligibleReplacementAndObservedFunding() public {
        bytes32 receipt = _deposit(100 ether);
        bytes32 remediationId = keccak256("replacement-remediation");
        vm.prank(policyAuthority);
        escrow.openRemediation(remediationId, receipt, alice, replacement, address(token), 100 ether, keccak256("policy-v1"));
        vm.prank(approver);
        escrow.approve(remediationId);
        oracle.setWalletAllowed(replacement, false);
        vm.prank(alice);
        vm.expectRevert(BoundVault.Ineligible.selector);
        vault.fundAuthorizedRemediation(remediationId, receipt, 100 ether, keccak256("tx-remediation"));

        vm.prank(address(vault));
        vm.expectRevert(RemediationEscrow.FundingNotPrepared.selector);
        escrow.receiveFromAuthorizedVault(remediationId, alice, 100 ether);
    }

    function test_collateralCanBeReleasedAfterDebtRepayment() public {
        bytes32 receipt = _deposit(100 ether);
        vm.prank(alice);
        bytes32 collateral = market.collateralize(receipt, 80 ether, keccak256("tx-collateral"), EVIDENCE);
        vm.prank(alice);
        market.borrow(collateral, 50 ether, keccak256("tx-borrow"), EVIDENCE);
        vm.prank(alice);
        vm.expectRevert(MockCreditMarket.OutstandingDebt.selector);
        market.releaseCollateral(collateral);
        vm.prank(alice);
        market.repay(collateral, 50 ether);
        vm.prank(alice);
        market.releaseCollateral(collateral);
        assertEq(vault.receiptBalanceOf(alice), 100 ether);
    }

    function test_remediationCannotSeizeUnfundedReceipt() public {
        bytes32 receipt = _deposit(100 ether);
        bytes32 remediationId = keccak256("remediation");
        vm.prank(policyAuthority);
        escrow.openRemediation(remediationId, receipt, alice, replacement, address(token), 100 ether, keccak256("policy-v1"));
        vm.prank(approver);
        escrow.approve(remediationId);

        vm.prank(stranger);
        vm.expectRevert(RemediationEscrow.Unauthorized.selector);
        escrow.receiveFromAuthorizedVault(remediationId, alice, 100 ether);
        vm.prank(policyAuthority);
        vm.expectRevert(RemediationEscrow.InvalidStatus.selector);
        escrow.release(remediationId);
        assertEq(vault.receiptBalanceOf(alice), 100 ether);
    }
}
