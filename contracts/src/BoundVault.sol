// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {
    IERC20Minimal,
    IEligibilityOracle,
    IPolicyManifestRegistry,
    IPositionLineageRegistry,
    IRemediationEscrow
} from "./SutureInterfaces.sol";

contract BoundVault {
    error Unauthorized();
    error Ineligible();
    error PolicyBlocked();
    error TransferFailed();
    error ZeroReference();
    error InvalidReceipt();
    error InsufficientReceiptBalance();
    error InvalidRemediation();
    error UnexpectedAssetReceipt();

    struct ReceiptPosition {
        address owner;
        uint256 remainingAssets;
        uint64 policyVersion;
        bool active;
    }

    IERC20Minimal public immutable asset;
    IEligibilityOracle public immutable eligibility;
    IPolicyManifestRegistry public immutable policies;
    IPositionLineageRegistry public immutable lineageRegistry;
    address public immutable authority;
    IRemediationEscrow public remediationEscrow;

    uint256 private nextReceiptNonce = 1;
    mapping(address owner => uint256 balance) public receiptBalanceOf;
    mapping(bytes32 positionId => ReceiptPosition position) public receiptPositions;
    mapping(address market => bool allowed) public authorizedMarkets;

    event Deposited(
        address indexed caller,
        address indexed receiver,
        bytes32 indexed sourcePositionId,
        bytes32 receiptPositionId,
        uint256 assets,
        uint64 policyVersion
    );
    event RestrictedExit(address indexed owner, address indexed receiver, bytes32 indexed receiptPositionId, uint256 assets);
    event ReceiptLocked(bytes32 indexed receiptPositionId, address indexed owner, address indexed market, uint256 assets);
    event MarketAuthorizationChanged(address indexed market, bool allowed, address indexed actor);
    event RemediationEscrowChanged(address indexed escrow, address indexed actor);
    event ReceiptUnlocked(bytes32 indexed receiptPositionId, address indexed owner, address indexed market, uint256 assets);

    constructor(
        address authority_,
        address asset_,
        address eligibility_,
        address policies_,
        address lineageRegistry_
    ) {
        if (
            authority_ == address(0) || asset_ == address(0) || eligibility_ == address(0) || policies_ == address(0)
                || lineageRegistry_ == address(0)
        ) revert ZeroReference();
        authority = authority_;
        asset = IERC20Minimal(asset_);
        eligibility = IEligibilityOracle(eligibility_);
        policies = IPolicyManifestRegistry(policies_);
        lineageRegistry = IPositionLineageRegistry(lineageRegistry_);
    }

    modifier onlyAuthority() {
        if (msg.sender != authority) revert Unauthorized();
        _;
    }

    modifier onlyAuthorizedMarket() {
        if (!authorizedMarkets[msg.sender]) revert Unauthorized();
        _;
    }

    function setAuthorizedMarket(address market, bool allowed) external onlyAuthority {
        if (market == address(0)) revert ZeroReference();
        authorizedMarkets[market] = allowed;
        emit MarketAuthorizationChanged(market, allowed, msg.sender);
    }

    function setRemediationEscrow(address escrow) external onlyAuthority {
        if (escrow == address(0)) revert ZeroReference();
        remediationEscrow = IRemediationEscrow(escrow);
        emit RemediationEscrowChanged(escrow, msg.sender);
    }

    function deposit(
        uint256 assets,
        address receiver,
        bytes32 sourcePositionId,
        bytes32 transactionReference,
        bytes32 evidenceReference
    ) external returns (bytes32 receiptPositionId) {
        if (assets == 0 || receiver == address(0) || sourcePositionId == bytes32(0) || transactionReference == bytes32(0)) {
            revert ZeroReference();
        }
        IPolicyManifestRegistry.PolicyRef memory policy = policies.activePolicy(address(asset));
        if (!policy.active || !policies.policyAllows(address(asset), policy.version, false)) revert PolicyBlocked();
        if (
            !eligibility.mayPerform(msg.sender, address(asset), this.deposit.selector)
                || !eligibility.mayPerform(receiver, address(asset), this.deposit.selector)
        ) revert Ineligible();
        uint256 balanceBefore = asset.balanceOf(address(this));
        if (!asset.transferFrom(msg.sender, address(this), assets)) revert TransferFailed();
        uint256 received = asset.balanceOf(address(this)) - balanceBefore;
        if (received != assets) revert UnexpectedAssetReceipt();

        receiptPositionId = keccak256(abi.encode(address(this), receiver, nextReceiptNonce++));
        receiptPositions[receiptPositionId] = ReceiptPosition({
            owner: receiver,
            remainingAssets: received,
            policyVersion: policy.version,
            active: true
        });
        receiptBalanceOf[receiver] += received;
        lineageRegistry.recordLineage(
            keccak256(abi.encode("vault_deposit", receiptPositionId, transactionReference)),
            sourcePositionId,
            receiptPositionId,
            receiver,
            policy.version,
            transactionReference,
            evidenceReference,
            IPositionLineageRegistry.EvidenceState.Asserted
        );
        emit Deposited(msg.sender, receiver, sourcePositionId, receiptPositionId, received, policy.version);
    }

    function redeemRestricted(
        bytes32 receiptPositionId,
        uint256 assets,
        address receiver,
        bytes32 transactionReference
    ) external {
        if (receiver == address(0) || transactionReference == bytes32(0)) revert ZeroReference();
        ReceiptPosition storage receipt = _ownedReceipt(receiptPositionId, msg.sender, assets);
        if (!policies.policyAllows(address(asset), receipt.policyVersion, true)) revert PolicyBlocked();
        if (
            !eligibility.mayPerform(msg.sender, address(asset), this.redeemRestricted.selector)
                || !eligibility.mayPerform(receiver, address(asset), this.redeemRestricted.selector)
        ) revert Ineligible();
        _reduceReceipt(receipt, msg.sender, assets);
        uint256 receiverBalanceBefore = asset.balanceOf(receiver);
        if (!asset.transfer(receiver, assets)) revert TransferFailed();
        if (asset.balanceOf(receiver) - receiverBalanceBefore != assets) revert UnexpectedAssetReceipt();
        emit RestrictedExit(msg.sender, receiver, receiptPositionId, assets);
    }

    function fundAuthorizedRemediation(
        bytes32 remediationId,
        bytes32 receiptPositionId,
        uint256 assets,
        bytes32 transactionReference
    ) external {
        if (address(remediationEscrow) == address(0) || remediationId == bytes32(0) || transactionReference == bytes32(0)) {
            revert ZeroReference();
        }
        ReceiptPosition storage receipt = _ownedReceipt(receiptPositionId, msg.sender, assets);
        if (!policies.policyAllows(address(asset), receipt.policyVersion, true)) revert PolicyBlocked();
        IRemediationEscrow.Remediation memory remediation = remediationEscrow.remediation(remediationId);
        if (
            remediation.status != IRemediationEscrow.Status.Approved || remediation.positionId != receiptPositionId
                || remediation.sourceWallet != msg.sender || remediation.asset != address(asset) || remediation.expectedAmount != assets
        ) revert InvalidRemediation();
        IPolicyManifestRegistry.PolicyRef memory policy = policies.policyVersion(address(asset), receipt.policyVersion);
        if (
            remediation.policyHash != policy.policyHash
                || !eligibility.mayPerform(remediation.replacementWallet, address(asset), this.redeemRestricted.selector)
        ) revert Ineligible();
        _reduceReceipt(receipt, msg.sender, assets);
        remediationEscrow.beginAuthorizedFunding(remediationId, msg.sender, assets);
        if (!asset.transfer(address(remediationEscrow), assets)) revert TransferFailed();
        remediationEscrow.receiveFromAuthorizedVault(remediationId, msg.sender, assets);
        emit RestrictedExit(msg.sender, address(remediationEscrow), receiptPositionId, assets);
    }

    function lockForCollateral(bytes32 receiptPositionId, address owner, uint256 assets)
        external
        onlyAuthorizedMarket
        returns (uint64 policyVersion)
    {
        ReceiptPosition storage receipt = _ownedReceipt(receiptPositionId, owner, assets);
        if (!policies.policyAllows(address(asset), receipt.policyVersion, false)) revert PolicyBlocked();
        if (!eligibility.mayPerform(owner, address(asset), this.lockForCollateral.selector)) revert Ineligible();
        policyVersion = receipt.policyVersion;
        _reduceReceipt(receipt, owner, assets);
        emit ReceiptLocked(receiptPositionId, owner, msg.sender, assets);
    }

    function unlockFromCollateral(bytes32 receiptPositionId, address owner, uint256 assets, uint64 policyVersion)
        external
        onlyAuthorizedMarket
    {
        if (assets == 0) revert ZeroReference();
        ReceiptPosition storage receipt = receiptPositions[receiptPositionId];
        if (receipt.owner != owner || receipt.policyVersion != policyVersion) revert InvalidReceipt();
        if (!policies.policyAllows(address(asset), policyVersion, true)) revert PolicyBlocked();
        receipt.remainingAssets += assets;
        receipt.active = true;
        receiptBalanceOf[owner] += assets;
        emit ReceiptUnlocked(receiptPositionId, owner, msg.sender, assets);
    }

    function _ownedReceipt(bytes32 receiptPositionId, address owner, uint256 assets)
        private
        view
        returns (ReceiptPosition storage receipt)
    {
        if (assets == 0) revert ZeroReference();
        receipt = receiptPositions[receiptPositionId];
        if (!receipt.active || receipt.owner != owner) revert InvalidReceipt();
        if (receipt.remainingAssets < assets || receiptBalanceOf[owner] < assets) revert InsufficientReceiptBalance();
    }

    function _reduceReceipt(ReceiptPosition storage receipt, address owner, uint256 assets) private {
        receipt.remainingAssets -= assets;
        receiptBalanceOf[owner] -= assets;
        if (receipt.remainingAssets == 0) receipt.active = false;
    }
}
