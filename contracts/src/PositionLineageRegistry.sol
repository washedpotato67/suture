// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPositionLineageRegistry} from "./SutureInterfaces.sol";

contract PositionLineageRegistry is IPositionLineageRegistry {
    error Unauthorized();
    error LineageAlreadyRecorded();
    error ZeroReference();
    error SelfReferentialLineage();
    error UntrustedEvidence();

    address public immutable authority;
    mapping(address recorder => bool allowed) public recorders;
    mapping(bytes32 lineageId => LineageEdge edge) private edges;

    constructor(address authority_) {
        if (authority_ == address(0)) revert ZeroReference();
        authority = authority_;
    }

    modifier onlyAuthority() {
        if (msg.sender != authority) revert Unauthorized();
        _;
    }

    modifier onlyRecorder() {
        if (!recorders[msg.sender]) revert Unauthorized();
        _;
    }

    function setRecorder(address recorder, bool allowed) external onlyAuthority {
        if (recorder == address(0)) revert ZeroReference();
        recorders[recorder] = allowed;
        emit RecorderUpdated(recorder, allowed, msg.sender);
    }

    function recordLineage(
        bytes32 lineageId,
        bytes32 sourcePositionId,
        bytes32 derivedPositionId,
        address owner,
        uint64 policyVersion,
        bytes32 transactionReference,
        bytes32 evidenceReference,
        EvidenceState evidenceState
    ) external onlyRecorder {
        if (edges[lineageId].lineageId != bytes32(0)) revert LineageAlreadyRecorded();
        if (
            lineageId == bytes32(0) || sourcePositionId == bytes32(0) || derivedPositionId == bytes32(0)
                || owner == address(0) || transactionReference == bytes32(0)
        ) revert ZeroReference();
        if (sourcePositionId == derivedPositionId) revert SelfReferentialLineage();
        // Contracts observe their own state transitions only. External provenance
        // must remain asserted until a trusted attestation bridge is introduced.
        if (evidenceState != EvidenceState.Asserted) revert UntrustedEvidence();

        LineageEdge memory edge = LineageEdge({
            lineageId: lineageId,
            sourcePositionId: sourcePositionId,
            derivedPositionId: derivedPositionId,
            protocol: msg.sender,
            owner: owner,
            policyVersion: policyVersion,
            transactionReference: transactionReference,
            evidenceReference: evidenceReference,
            recordedAt: uint64(block.timestamp),
            evidenceState: evidenceState
        });
        edges[lineageId] = edge;
        emit LineageRecorded(
            lineageId,
            sourcePositionId,
            derivedPositionId,
            msg.sender,
            owner,
            policyVersion,
            transactionReference,
            evidenceReference,
            evidenceState
        );
    }

    function lineage(bytes32 lineageId) external view returns (LineageEdge memory) {
        return edges[lineageId];
    }
}
