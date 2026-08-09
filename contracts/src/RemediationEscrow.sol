// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20Minimal, IRemediationEscrow} from "./SutureInterfaces.sol";

contract RemediationEscrow is IRemediationEscrow {
    error Unauthorized();
    error InvalidStatus();
    error DuplicateRemediation();
    error ZeroReference();
    error InvalidFunding();
    error TransferFailed();
    error FundingNotPrepared();

    address public immutable policyAuthority;
    address public immutable approver;
    mapping(address vault => bool allowed) public authorizedVaults;
    mapping(bytes32 remediationId => Remediation item) private remediations;
    mapping(bytes32 remediationId => uint256 balanceBeforeFunding) private fundingStartBalance;
    mapping(bytes32 remediationId => bool preparedFunding) private fundingPrepared;

    constructor(address policyAuthority_, address approver_) {
        if (policyAuthority_ == address(0) || approver_ == address(0)) revert ZeroReference();
        policyAuthority = policyAuthority_;
        approver = approver_;
    }

    modifier onlyPolicyAuthority() {
        if (msg.sender != policyAuthority) revert Unauthorized();
        _;
    }

    function setAuthorizedVault(address vault, bool allowed) external onlyPolicyAuthority {
        if (vault == address(0)) revert ZeroReference();
        authorizedVaults[vault] = allowed;
        emit VaultAuthorizationChanged(vault, allowed, msg.sender);
    }

    function openRemediation(
        bytes32 remediationId,
        bytes32 positionId,
        address sourceWallet,
        address replacementWallet,
        address asset,
        uint256 expectedAmount,
        bytes32 policyHash
    ) external onlyPolicyAuthority {
        if (remediations[remediationId].status != Status.None) revert DuplicateRemediation();
        if (
            remediationId == bytes32(0) || positionId == bytes32(0) || sourceWallet == address(0)
                || replacementWallet == address(0) || asset == address(0) || expectedAmount == 0 || policyHash == bytes32(0)
        ) revert ZeroReference();
        remediations[remediationId] = Remediation({
            positionId: positionId,
            sourceWallet: sourceWallet,
            replacementWallet: replacementWallet,
            asset: asset,
            expectedAmount: expectedAmount,
            fundedAmount: 0,
            policyHash: policyHash,
            status: Status.PendingApproval
        });
        emit RemediationOpened(remediationId, positionId, msg.sender);
    }

    function approve(bytes32 remediationId) external {
        if (msg.sender != approver) revert Unauthorized();
        Remediation storage item = remediations[remediationId];
        if (item.status != Status.PendingApproval) revert InvalidStatus();
        item.status = Status.Approved;
        emit RemediationApproved(remediationId, msg.sender);
    }

    function beginAuthorizedFunding(bytes32 remediationId, address sourceWallet, uint256 amount) external {
        if (!authorizedVaults[msg.sender]) revert Unauthorized();
        Remediation storage item = remediations[remediationId];
        if (item.status != Status.Approved) revert InvalidStatus();
        if (item.sourceWallet != sourceWallet || item.expectedAmount != amount || fundingPrepared[remediationId]) {
            revert InvalidFunding();
        }
        fundingStartBalance[remediationId] = IERC20Minimal(item.asset).balanceOf(address(this));
        fundingPrepared[remediationId] = true;
    }

    function receiveFromAuthorizedVault(bytes32 remediationId, address sourceWallet, uint256 amount) external {
        if (!authorizedVaults[msg.sender]) revert Unauthorized();
        Remediation storage item = remediations[remediationId];
        if (item.status != Status.Approved) revert InvalidStatus();
        if (item.sourceWallet != sourceWallet || item.expectedAmount != amount || item.fundedAmount != 0) {
            revert InvalidFunding();
        }
        if (!fundingPrepared[remediationId]) revert FundingNotPrepared();
        uint256 balanceBefore = fundingStartBalance[remediationId];
        if (IERC20Minimal(item.asset).balanceOf(address(this)) < balanceBefore + amount) revert InvalidFunding();
        delete fundingStartBalance[remediationId];
        delete fundingPrepared[remediationId];
        item.fundedAmount = amount;
        item.status = Status.Funded;
        emit RemediationFunded(remediationId, sourceWallet, amount);
    }

    function release(bytes32 remediationId) external onlyPolicyAuthority {
        Remediation storage item = remediations[remediationId];
        if (item.status != Status.Funded || item.fundedAmount != item.expectedAmount) revert InvalidStatus();
        item.status = Status.Executed;
        uint256 recipientBalanceBefore = IERC20Minimal(item.asset).balanceOf(item.replacementWallet);
        if (!IERC20Minimal(item.asset).transfer(item.replacementWallet, item.fundedAmount)) revert TransferFailed();
        if (IERC20Minimal(item.asset).balanceOf(item.replacementWallet) - recipientBalanceBefore != item.fundedAmount) {
            revert TransferFailed();
        }
        emit RemediationExecuted(remediationId, item.replacementWallet, item.fundedAmount);
    }

    function remediation(bytes32 remediationId) external view returns (Remediation memory) {
        return remediations[remediationId];
    }
}
