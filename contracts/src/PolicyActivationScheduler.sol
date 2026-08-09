// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IPolicyActivation {
    function activatePolicy(
        address asset,
        uint64 version,
        bytes32 policyHash,
        bytes32 policyReference,
        uint64 effectiveAt
    ) external;
}

/**
 * Authorized activation scheduler.
 *
 * PolicyManifestRegistry enforces `effectiveAt == block.timestamp` so that a
 * policy can never be back-dated or silently pre-scheduled. That check is
 * correct, but it makes activation unreachable for an externally owned account:
 * a broadcast transaction lands in a future block whose timestamp the sender
 * cannot know, so the supplied value is always stale on arrival.
 *
 * This contract closes that gap without weakening the invariant. It holds the
 * policy authority and reads `block.timestamp` inside the same transaction that
 * performs the activation, so the value is correct by construction.
 *
 * The registry's own test suite names this absence
 * (`test_policyRejectsFutureActivationUntilAnAuthorizedSchedulerExists`).
 */
contract PolicyActivationScheduler {
    IPolicyActivation public immutable registry;
    address public owner;

    error Unauthorized();
    error ZeroReference();

    event OwnerChanged(address indexed previousOwner, address indexed newOwner);
    event PolicyActivated(address indexed asset, uint64 indexed version, uint64 effectiveAt);

    constructor(address registry_, address owner_) {
        if (registry_ == address(0) || owner_ == address(0)) revert ZeroReference();
        registry = IPolicyActivation(registry_);
        owner = owner_;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    function setOwner(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert ZeroReference();
        address previous = owner;
        owner = nextOwner;
        emit OwnerChanged(previous, nextOwner);
    }

    /// Activates with the executing block's timestamp, satisfying the registry's
    /// same-block requirement without permitting a caller-chosen time.
    function activateNow(address asset, uint64 version, bytes32 policyHash, bytes32 policyReference)
        external
        onlyOwner
    {
        uint64 effectiveAt = uint64(block.timestamp);
        registry.activatePolicy(asset, version, policyHash, policyReference, effectiveAt);
        emit PolicyActivated(asset, version, effectiveAt);
    }
}
