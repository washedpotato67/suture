# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Issuer administrator and compliance operator at a regulated asset issuer (confirmed). They work an incident during a review or a live demonstration: a credential or policy event has made downstream positions non-compliant, and they must see the blast radius, authorize a recovery path, and produce evidence. Secondary audiences named in the product spec: protocol integrator, auditor, organization owner.

## Product Purpose

SUTURE is the compliance continuity layer for tokenized assets in DeFi. It tracks regulated assets through vaults, collateral, and other derived positions, detects when identity or policy changes make them non-compliant, and coordinates safe recovery with a complete audit trail. Primary promise: compliance that survives composition. Success for the console: a reviewer understands the source-to-derived chain in seconds, sees every position affected by a revocation, can tell asserted demo evidence from verified evidence, sees why movement is blocked, and can identify the approval required for the proposed recovery.

## Positioning

The originating policy stays attached to every derived position — lineage with policy version and evidence state on every edge — and recovery is approval-gated, idempotent, and receipted. Neighboring tools show balances or alerts; none carry the policy thread through composition or close the broken path with an audit trail.

## Operating Context

Desktop-first institutional console. The v0.1 scenario: one issuer org, one private-credit note, source + replacement wallet, vault receipt, collateral, debt position, one credential-revocation incident. Local Supabase stack or fixture demo mode. Hackathon/reviewer demonstration is a real usage scene.

## Capabilities and Constraints

- Truthfulness is a product feature: every record carries an evidence state (none/asserted/verified/contested); demo data is labeled DEMO DATA; no live Cleanverse/Monad call, deployment, or on-chain transaction has been executed and the UI must never imply otherwise.
- Consequential remediation is authorized by explicit approval records via server RPCs, never UI state; execution is idempotent; uncertain outcomes must reconcile before retry.
- No legal eligibility determination, no custody, no live KYC, no automatic seizure.
- Terminology: lineage, blast radius, preflight, policy version, remediation plan, audit receipt, CVI/CVA/CCP, Monad.

## Brand Commitments

Working name SUTURE (pending trademark review). Brand idea: a policy thread kept attached across derived positions; closing a broken compliance path. Visual language named in docs: precise joins, seams, repaired paths. Primary line: "Compliance that survives composition." Secondary: "Trace every derived position. Repair every broken policy path."

## Evidence on Hand

Deterministic demo scenario (Northstar Capital private-credit note), fixtures in `src/domain/fixtures.ts`, seeded demo workspace via `create_organization_with_demo_data`. No real customers, benchmarks, or live provider data — future work must not fabricate them.

## Product Principles

- Truthfulness over theater: never imply a call, deployment, or verification that did not happen.
- The graph is the argument: source-to-derived lineage is the fastest way to understand exposure.
- Authority is explicit: consequential action requires a recorded approval, and the UI shows who must act.
- Recovery, not punishment: the goal is a safe, receipted path back to compliance.
