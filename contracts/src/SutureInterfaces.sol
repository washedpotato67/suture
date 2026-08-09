// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IEligibilityOracle {
    function mayPerform(address wallet, address asset, bytes4 action) external view returns (bool);
}

interface IPolicyManifestRegistry {
    enum EmergencyStatus {
        Normal,
        ExitOnly,
        Paused
    }

    struct PolicyRef {
        bytes32 policyHash;
        bytes32 policyReference;
        uint64 version;
        uint64 effectiveAt;
        EmergencyStatus emergencyStatus;
        bool active;
    }

    event PolicyActivated(
        address indexed asset,
        uint64 indexed version,
        bytes32 indexed policyHash,
        bytes32 policyReference,
        uint64 effectiveAt
    );
    event PolicySuperseded(address indexed asset, uint64 indexed oldVersion, uint64 indexed newVersion);
    event EmergencyStatusChanged(address indexed asset, EmergencyStatus status, address indexed actor);
    event PolicyAuthorityChanged(address indexed previousAuthority, address indexed nextAuthority);

    function activePolicy(address asset) external view returns (PolicyRef memory);
    function policyVersion(address asset, uint64 version) external view returns (PolicyRef memory);
    function policyAllows(address asset, uint64 version, bool isRestrictedExit) external view returns (bool);
}

interface IPositionLineageRegistry {
    enum EvidenceState {
        None,
        Asserted,
        Verified,
        Contested
    }

    struct LineageEdge {
        bytes32 lineageId;
        bytes32 sourcePositionId;
        bytes32 derivedPositionId;
        address protocol;
        address owner;
        uint64 policyVersion;
        bytes32 transactionReference;
        bytes32 evidenceReference;
        uint64 recordedAt;
        EvidenceState evidenceState;
    }

    event LineageRecorded(
        bytes32 indexed lineageId,
        bytes32 indexed sourcePositionId,
        bytes32 indexed derivedPositionId,
        address protocol,
        address owner,
        uint64 policyVersion,
        bytes32 transactionReference,
        bytes32 evidenceReference,
        EvidenceState evidenceState
    );
    event RecorderUpdated(address indexed recorder, bool allowed, address indexed actor);

    function recordLineage(
        bytes32 lineageId,
        bytes32 sourcePositionId,
        bytes32 derivedPositionId,
        address owner,
        uint64 policyVersion,
        bytes32 transactionReference,
        bytes32 evidenceReference,
        EvidenceState evidenceState
    ) external;

    function lineage(bytes32 lineageId) external view returns (LineageEdge memory);
}

interface IRemediationEscrow {
    enum Status {
        None,
        PendingApproval,
        Approved,
        Funded,
        Executed,
        Cancelled
    }

    struct Remediation {
        bytes32 positionId;
        address sourceWallet;
        address replacementWallet;
        address asset;
        uint256 expectedAmount;
        uint256 fundedAmount;
        bytes32 policyHash;
        Status status;
    }

    event RemediationOpened(bytes32 indexed remediationId, bytes32 indexed positionId, address indexed authority);
    event RemediationApproved(bytes32 indexed remediationId, address indexed approver);
    event RemediationFunded(bytes32 indexed remediationId, address indexed sourceWallet, uint256 amount);
    event RemediationExecuted(bytes32 indexed remediationId, address indexed recipient, uint256 amount);
    event VaultAuthorizationChanged(address indexed vault, bool allowed, address indexed actor);

    function openRemediation(
        bytes32 remediationId,
        bytes32 positionId,
        address sourceWallet,
        address replacementWallet,
        address asset,
        uint256 expectedAmount,
        bytes32 policyHash
    ) external;

    function approve(bytes32 remediationId) external;
    function beginAuthorizedFunding(bytes32 remediationId, address sourceWallet, uint256 amount) external;
    function receiveFromAuthorizedVault(bytes32 remediationId, address sourceWallet, uint256 amount) external;
    function release(bytes32 remediationId) external;
    function remediation(bytes32 remediationId) external view returns (Remediation memory);
}
