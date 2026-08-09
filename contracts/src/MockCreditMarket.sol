// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IEligibilityOracle, IPolicyManifestRegistry, IPositionLineageRegistry} from "./SutureInterfaces.sol";
import {BoundVault} from "./BoundVault.sol";

contract MockCreditMarket {
    error Ineligible();
    error PolicyBlocked();
    error ZeroReference();
    error InvalidCollateral();
    error InsufficientCollateral();
    error OutstandingDebt();

    struct CollateralPosition {
        address owner;
        bytes32 vaultReceiptPositionId;
        uint256 collateralAmount;
        uint256 debtAmount;
        uint64 policyVersion;
        bool active;
    }

    BoundVault public immutable vault;
    IEligibilityOracle public immutable eligibility;
    IPolicyManifestRegistry public immutable policies;
    IPositionLineageRegistry public immutable lineageRegistry;
    uint256 private nextCollateralNonce = 1;
    uint256 private nextDebtNonce = 1;
    mapping(bytes32 positionId => CollateralPosition position) public collateralPositions;

    event Collateralized(
        address indexed owner,
        bytes32 indexed vaultReceiptPositionId,
        bytes32 indexed collateralPositionId,
        uint256 amount,
        uint64 policyVersion
    );
    event DebtOpened(address indexed owner, bytes32 indexed collateralPositionId, bytes32 indexed debtPositionId, uint256 amount);
    event DebtRepaid(address indexed owner, bytes32 indexed collateralPositionId, uint256 amount);
    event CollateralReleased(address indexed owner, bytes32 indexed collateralPositionId, uint256 amount);

    constructor(address vault_, address eligibility_, address policies_, address lineageRegistry_) {
        if (vault_ == address(0) || eligibility_ == address(0) || policies_ == address(0) || lineageRegistry_ == address(0)) {
            revert ZeroReference();
        }
        vault = BoundVault(vault_);
        eligibility = IEligibilityOracle(eligibility_);
        policies = IPolicyManifestRegistry(policies_);
        lineageRegistry = IPositionLineageRegistry(lineageRegistry_);
    }

    function collateralize(
        bytes32 vaultReceiptPositionId,
        uint256 amount,
        bytes32 transactionReference,
        bytes32 evidenceReference
    ) external returns (bytes32 collateralPositionId) {
        if (vaultReceiptPositionId == bytes32(0) || amount == 0 || transactionReference == bytes32(0)) revert ZeroReference();
        if (!eligibility.mayPerform(msg.sender, address(vault.asset()), this.collateralize.selector)) revert Ineligible();
        uint64 policyVersion = vault.lockForCollateral(vaultReceiptPositionId, msg.sender, amount);
        if (!policies.policyAllows(address(vault.asset()), policyVersion, false)) revert PolicyBlocked();

        collateralPositionId = keccak256(abi.encode(address(this), msg.sender, nextCollateralNonce++));
        collateralPositions[collateralPositionId] = CollateralPosition({
            owner: msg.sender,
            vaultReceiptPositionId: vaultReceiptPositionId,
            collateralAmount: amount,
            debtAmount: 0,
            policyVersion: policyVersion,
            active: true
        });
        lineageRegistry.recordLineage(
            keccak256(abi.encode("collateralize", collateralPositionId, transactionReference)),
            vaultReceiptPositionId,
            collateralPositionId,
            msg.sender,
            policyVersion,
            transactionReference,
            evidenceReference,
            IPositionLineageRegistry.EvidenceState.Asserted
        );
        emit Collateralized(msg.sender, vaultReceiptPositionId, collateralPositionId, amount, policyVersion);
    }

    function borrow(bytes32 collateralPositionId, uint256 amount, bytes32 transactionReference, bytes32 evidenceReference)
        external
        returns (bytes32 debtPositionId)
    {
        if (amount == 0 || transactionReference == bytes32(0)) revert ZeroReference();
        CollateralPosition storage collateral = collateralPositions[collateralPositionId];
        if (!collateral.active || collateral.owner != msg.sender) revert InvalidCollateral();
        if (amount > collateral.collateralAmount - collateral.debtAmount) revert InsufficientCollateral();
        if (!policies.policyAllows(address(vault.asset()), collateral.policyVersion, false)) revert PolicyBlocked();
        if (!eligibility.mayPerform(msg.sender, address(vault.asset()), this.borrow.selector)) revert Ineligible();

        collateral.debtAmount += amount;
        debtPositionId = keccak256(abi.encode(address(this), collateralPositionId, nextDebtNonce++));
        lineageRegistry.recordLineage(
            keccak256(abi.encode("borrow", debtPositionId, transactionReference)),
            collateralPositionId,
            debtPositionId,
            msg.sender,
            collateral.policyVersion,
            transactionReference,
            evidenceReference,
            IPositionLineageRegistry.EvidenceState.Asserted
        );
        emit DebtOpened(msg.sender, collateralPositionId, debtPositionId, amount);
    }

    function repay(bytes32 collateralPositionId, uint256 amount) external {
        if (amount == 0) revert ZeroReference();
        CollateralPosition storage collateral = collateralPositions[collateralPositionId];
        if (!collateral.active || collateral.owner != msg.sender) revert InvalidCollateral();
        if (amount > collateral.debtAmount) revert InsufficientCollateral();
        collateral.debtAmount -= amount;
        emit DebtRepaid(msg.sender, collateralPositionId, amount);
    }

    function releaseCollateral(bytes32 collateralPositionId) external {
        CollateralPosition storage collateral = collateralPositions[collateralPositionId];
        if (!collateral.active || collateral.owner != msg.sender) revert InvalidCollateral();
        if (collateral.debtAmount != 0) revert OutstandingDebt();
        collateral.active = false;
        vault.unlockFromCollateral(
            collateral.vaultReceiptPositionId, collateral.owner, collateral.collateralAmount, collateral.policyVersion
        );
        emit CollateralReleased(msg.sender, collateralPositionId, collateral.collateralAmount);
    }
}
