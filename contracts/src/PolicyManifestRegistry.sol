// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPolicyManifestRegistry} from "./SutureInterfaces.sol";

contract PolicyManifestRegistry is IPolicyManifestRegistry {
    error Unauthorized();
    error NonMonotonicVersion();
    error ZeroReference();
    error InvalidEffectiveTime();
    error UnknownPolicyVersion();

    address public immutable issuer;
    address public policyAuthority;
    mapping(address asset => PolicyRef policy) private activePolicies;
    mapping(address asset => mapping(uint64 version => PolicyRef policy)) private historicalPolicies;

    constructor(address issuer_, address policyAuthority_) {
        if (issuer_ == address(0) || policyAuthority_ == address(0)) revert ZeroReference();
        issuer = issuer_;
        policyAuthority = policyAuthority_;
    }

    modifier onlyIssuer() {
        if (msg.sender != issuer) revert Unauthorized();
        _;
    }

    modifier onlyPolicyAuthority() {
        if (msg.sender != policyAuthority) revert Unauthorized();
        _;
    }

    function setPolicyAuthority(address nextAuthority) external onlyIssuer {
        if (nextAuthority == address(0)) revert ZeroReference();
        address previousAuthority = policyAuthority;
        policyAuthority = nextAuthority;
        emit PolicyAuthorityChanged(previousAuthority, nextAuthority);
    }

    function activatePolicy(
        address asset,
        uint64 version,
        bytes32 policyHash,
        bytes32 policyReference,
        uint64 effectiveAt
    ) external onlyPolicyAuthority {
        if (asset == address(0) || policyHash == bytes32(0) || policyReference == bytes32(0)) {
            revert ZeroReference();
        }
        // A future version must not replace the currently enforceable policy.
        // Scheduled activation belongs in an explicit, separately authorized flow.
        if (effectiveAt != block.timestamp) revert InvalidEffectiveTime();

        PolicyRef memory current = activePolicies[asset];
        if (version <= current.version || historicalPolicies[asset][version].policyHash != bytes32(0)) {
            revert NonMonotonicVersion();
        }

        PolicyRef memory next = PolicyRef({
            policyHash: policyHash,
            policyReference: policyReference,
            version: version,
            effectiveAt: effectiveAt,
            emergencyStatus: EmergencyStatus.Normal,
            active: true
        });
        historicalPolicies[asset][version] = next;
        activePolicies[asset] = next;
        if (current.active) emit PolicySuperseded(asset, current.version, version);
        emit PolicyActivated(asset, version, policyHash, policyReference, effectiveAt);
    }

    function setEmergencyStatus(address asset, EmergencyStatus status) external onlyIssuer {
        PolicyRef storage current = activePolicies[asset];
        if (!current.active) revert UnknownPolicyVersion();
        current.emergencyStatus = status;
        emit EmergencyStatusChanged(asset, status, msg.sender);
    }

    function activePolicy(address asset) external view returns (PolicyRef memory) {
        return activePolicies[asset];
    }

    function policyVersion(address asset, uint64 version) external view returns (PolicyRef memory) {
        return historicalPolicies[asset][version];
    }

    function policyAllows(address asset, uint64 version, bool isRestrictedExit) external view returns (bool) {
        PolicyRef memory current = activePolicies[asset];
        if (!current.active || current.effectiveAt > block.timestamp) return false;
        if (current.emergencyStatus == EmergencyStatus.Paused) return false;
        if (isRestrictedExit) {
            return historicalPolicies[asset][version].policyHash != bytes32(0);
        }
        if (current.version != version) return false;
        if (current.emergencyStatus == EmergencyStatus.ExitOnly) return isRestrictedExit;
        return true;
    }
}
