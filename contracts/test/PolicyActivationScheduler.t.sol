// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PolicyManifestRegistry} from "../src/PolicyManifestRegistry.sol";
import {PolicyActivationScheduler} from "../src/PolicyActivationScheduler.sol";
import {IPolicyManifestRegistry} from "../src/SutureInterfaces.sol";

contract PolicyActivationSchedulerTest is Test {
    PolicyManifestRegistry internal policies;
    PolicyActivationScheduler internal scheduler;

    address internal issuer = makeAddr("issuer");
    address internal operator = makeAddr("operator");
    address internal asset = makeAddr("asset");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        policies = new PolicyManifestRegistry(issuer, issuer);
        scheduler = new PolicyActivationScheduler(address(policies), operator);
        vm.prank(issuer);
        policies.setPolicyAuthority(address(scheduler));
    }

    function test_activatesUsingTheExecutingBlockTimestamp() public {
        vm.warp(1_800_000_000);
        vm.prank(operator);
        scheduler.activateNow(asset, 1, keccak256("h1"), keccak256("r1"));

        IPolicyManifestRegistry.PolicyRef memory active = policies.activePolicy(asset);
        assertEq(active.version, 1);
        assertEq(active.effectiveAt, uint64(block.timestamp));
        assertTrue(active.active);
    }

    function test_activationSucceedsAtAnyBlockTimeWithoutCallerSuppliedTime() public {
        vm.warp(1_800_000_000);
        vm.prank(operator);
        scheduler.activateNow(asset, 1, keccak256("h1"), keccak256("r1"));

        // The failure mode this contract exists to fix: time moves on, and a
        // caller cannot predict the inclusion block. The scheduler is immune.
        vm.warp(block.timestamp + 3600);
        vm.prank(operator);
        scheduler.activateNow(asset, 2, keccak256("h2"), keccak256("r2"));

        IPolicyManifestRegistry.PolicyRef memory active = policies.activePolicy(asset);
        assertEq(active.version, 2);
        assertEq(active.effectiveAt, uint64(block.timestamp));
    }

    function test_directExternalActivationWithStaleTimeStillReverts() public {
        vm.warp(1_800_000_000);
        uint64 staleTime = uint64(block.timestamp);
        vm.warp(block.timestamp + 2);

        // Authority is the scheduler, so a direct call is unauthorized anyway;
        // this asserts the registry invariant is not weakened by its existence.
        vm.prank(address(scheduler));
        vm.expectRevert(PolicyManifestRegistry.InvalidEffectiveTime.selector);
        policies.activatePolicy(asset, 1, keccak256("h1"), keccak256("r1"), staleTime);
    }

    function test_onlyOwnerMayActivate() public {
        vm.prank(stranger);
        vm.expectRevert(PolicyActivationScheduler.Unauthorized.selector);
        scheduler.activateNow(asset, 1, keccak256("h1"), keccak256("r1"));
    }

    function test_ownerTransferIsAuthorized() public {
        vm.prank(stranger);
        vm.expectRevert(PolicyActivationScheduler.Unauthorized.selector);
        scheduler.setOwner(stranger);

        vm.prank(operator);
        scheduler.setOwner(stranger);
        assertEq(scheduler.owner(), stranger);
    }

    function test_monotonicVersionStillEnforcedThroughScheduler() public {
        vm.warp(1_800_000_000);
        vm.startPrank(operator);
        scheduler.activateNow(asset, 2, keccak256("h2"), keccak256("r2"));
        vm.warp(block.timestamp + 5);
        vm.expectRevert(PolicyManifestRegistry.NonMonotonicVersion.selector);
        scheduler.activateNow(asset, 1, keccak256("h1"), keccak256("r1"));
        vm.stopPrank();
    }
}
