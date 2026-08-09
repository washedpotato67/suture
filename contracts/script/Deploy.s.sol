// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {BoundVault} from "../src/BoundVault.sol";
import {MockCreditMarket} from "../src/MockCreditMarket.sol";
import {PolicyManifestRegistry} from "../src/PolicyManifestRegistry.sol";
import {PositionLineageRegistry} from "../src/PositionLineageRegistry.sol";
import {RemediationEscrow} from "../src/RemediationEscrow.sol";
import {MockERC20, MockEligibilityOracle} from "../test/Suture.t.sol";

/**
 * Deploys the SUTURE contract slice.
 *
 * The asset and the eligibility oracle are mocks: this slice demonstrates
 * policy activation, asserted lineage, bound receipts, and authority-gated
 * remediation. It is not a production asset or a real credential oracle, and
 * docs/DEPLOYMENTS.md must record it as such.
 *
 * The deployer holds every role (issuer, policy authority, approver) because a
 * testnet demonstration has no separation-of-duties requirement. Production
 * deployment must split these.
 */
contract Deploy is Script {
    function run() external {
        address deployer = msg.sender;

        vm.startBroadcast();

        MockERC20 token = new MockERC20();
        MockEligibilityOracle oracle = new MockEligibilityOracle();
        PolicyManifestRegistry policies = new PolicyManifestRegistry(deployer, deployer);
        PositionLineageRegistry lineage = new PositionLineageRegistry(deployer);
        BoundVault vault =
            new BoundVault(deployer, address(token), address(oracle), address(policies), address(lineage));
        MockCreditMarket market =
            new MockCreditMarket(address(vault), address(oracle), address(policies), address(lineage));
        RemediationEscrow escrow = new RemediationEscrow(deployer, deployer);

        lineage.setRecorder(address(vault), true);
        lineage.setRecorder(address(market), true);
        vault.setAuthorizedMarket(address(market), true);
        vault.setRemediationEscrow(address(escrow));
        escrow.setAuthorizedVault(address(vault), true);
        // Policy activation is deliberately NOT done here. PolicyManifestRegistry
        // requires effectiveAt == block.timestamp exactly, and a broadcast
        // transaction lands in a future block whose timestamp a script cannot
        // know. Activation is a separate send that reads the pending block
        // timestamp and retries; see script/activate-policy.sh.

        oracle.setWalletAllowed(deployer, true);
        oracle.setActionAllowed(vault.deposit.selector, true);
        oracle.setActionAllowed(vault.redeemRestricted.selector, true);
        oracle.setActionAllowed(vault.fundAuthorizedRemediation.selector, true);
        oracle.setActionAllowed(vault.lockForCollateral.selector, true);
        oracle.setActionAllowed(market.collateralize.selector, true);
        oracle.setActionAllowed(market.borrow.selector, true);

        token.mint(deployer, 1_000 ether);
        token.approve(address(vault), type(uint256).max);

        vm.stopBroadcast();

        console.log("chainid           ", block.chainid);
        console.log("deployer          ", deployer);
        console.log("MockERC20         ", address(token));
        console.log("EligibilityOracle ", address(oracle));
        console.log("PolicyManifest    ", address(policies));
        console.log("LineageRegistry   ", address(lineage));
        console.log("BoundVault        ", address(vault));
        console.log("CreditMarket      ", address(market));
        console.log("RemediationEscrow ", address(escrow));
    }
}
