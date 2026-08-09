import { AlertOctagon, ArrowRight, Check, CircleSlash2, FileCheck2, ShieldCheck, X } from "lucide-react";
import type { BlastRadius } from "../domain/lineage";
import type { Incident, LineageNode, RemediationPlan } from "../domain/types";
import { formatUsd, shortWallet, type OrgRole, type WorkspaceWallet } from "../lib/data";
import { FlapText } from "./FlapText";
import { StatusBadge } from "./StatusBadge";

export interface RemediationActions {
  requestApproval: (planId: string) => void;
  decideApproval: (planId: string, approve: boolean) => void;
  executePlan: (planId: string) => void;
  executeOnChain: (planId: string) => void;
}

interface IncidentsProps {
  incident: Incident;
  plan: RemediationPlan | null;
  nodes: LineageNode[];
  blast: BlastRadius;
  wallets: WorkspaceWallet[];
  role: OrgRole | null;
  isDemo: boolean;
  busy: string | null;
  actions: RemediationActions;
  onOpenReceipts: () => void;
}

const STATUS_FLAP_CLASS: Record<RemediationPlan["status"], string> = {
  draft: "status-steel",
  pending_approval: "status-amber",
  approved: "status-green",
  executing: "status-amber",
  uncertain: "status-red",
  resolved: "status-green",
  cancelled: "status-red",
};

export function Incidents({
  incident,
  plan,
  nodes,
  blast,
  wallets,
  role,
  isDemo,
  busy,
  actions,
  onOpenReceipts,
}: IncidentsProps) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const affected = blast.affectedNodeIds
    .map((id) => nodeById.get(id))
    .filter((node): node is LineageNode => Boolean(node));
  const replacementWallet = wallets.find((wallet) => wallet.address === plan?.replacementWallet);
  // Demo mode (role null) runs as a single operator with every capability.
  const canDecide = role === null || role === "owner" || role === "issuer_admin";

  return (
    <>
      <section className="two-column">
        <article className="panel incident-card">
          <div className="panel-heading compact">
            <div>
              <div className="eyebrow"><AlertOctagon size={13} /> INCIDENT {incident.id.slice(0, 8).toUpperCase()}</div>
              <h2>{incident.title}</h2>
            </div>
            <div className="heading-actions">
              <StatusBadge tone="bad">{incident.severity.toUpperCase()}</StatusBadge>
              <StatusBadge tone={incident.status === "resolved" ? "good" : "warn"}>
                {incident.status.replaceAll("_", " ").toUpperCase()}
              </StatusBadge>
            </div>
          </div>
          <p>{incident.summary}</p>
          <dl className="detail-list">
            <div><dt>Type</dt><dd>{incident.type.replaceAll("_", " ")}</dd></div>
            <div><dt>Detected</dt><dd className="mono">{new Date(incident.createdAt).toLocaleString()}</dd></div>
            <div><dt>Affected positions</dt><dd>{affected.length}</dd></div>
            <div><dt>Value at risk</dt><dd>{formatUsd(blast.affectedValueUsd)}</dd></div>
          </dl>
        </article>

        <article className="panel">
          <div className="panel-heading compact">
            <div>
              <div className="eyebrow"><ShieldCheck size={13} /> IMPACT SNAPSHOT</div>
              <h2>Blast radius, recomputed from stored lineage</h2>
            </div>
            <StatusBadge tone="muted">{blast.paths.length} PATHS</StatusBadge>
          </div>
          <div className="board-table">
            <div className="board-table-header">
              <span>Position</span><span>Value</span><span>State</span><span>Policy</span>
            </div>
            {affected.map((node) => (
              <div className="board-table-row" key={node.id}>
                <span><FlapText text={node.label.toUpperCase()} className="flap-wrap" /></span>
                <span className="mono">{formatUsd(node.amountUsd)}</span>
                <span>
                  <StatusBadge tone={node.state === "blocked" ? "bad" : node.state === "at_risk" ? "warn" : "good"}>
                    {node.state.replaceAll("_", " ").toUpperCase()}
                  </StatusBadge>
                </span>
                <span className="mono">{node.policyVersion}</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading compact">
          <div>
            <div className="eyebrow"><FileCheck2 size={13} /> REMEDIATION</div>
            <h2>Replacement-wallet migration</h2>
          </div>
        </div>

        {!plan && <p className="muted-copy">No remediation plan exists for this incident.</p>}

        {plan && (
          <>
            <div className="plan-status">
              <span className="eyebrow">BOARD STATUS</span>
              <FlapText
                text={plan.status.replaceAll("_", " ").toUpperCase()}
                className={STATUS_FLAP_CLASS[plan.status]}
              />
            </div>
            <dl className="detail-list">
              <div><dt>Action</dt><dd>{plan.planType.replaceAll("_", " ")}</dd></div>
              <div><dt>Source wallet</dt><dd className="mono">{shortWallet(plan.sourceWallet)}</dd></div>
              <div>
                <dt>Replacement wallet</dt>
                <dd className="mono">
                  {shortWallet(plan.replacementWallet)}
                  {replacementWallet && <> · credential {replacementWallet.credentialState}</>}
                </dd>
              </div>
              <div><dt>Idempotency key</dt><dd className="mono">{plan.idempotencyKey}</dd></div>
              {plan.approvedAt && <div><dt>Approved</dt><dd className="mono">{new Date(plan.approvedAt).toLocaleString()}</dd></div>}
              {plan.executedAt && <div><dt>Executed</dt><dd className="mono">{new Date(plan.executedAt).toLocaleString()}</dd></div>}
            </dl>

            <div className="plan-actions">
              {plan.status === "draft" && (
                <button className="primary-button" type="button" disabled={busy !== null} onClick={() => actions.requestApproval(plan.id)}>
                  <ArrowRight size={15} /> {busy === "request" ? "Requesting…" : "Request issuer approval"}
                </button>
              )}
              {plan.status === "pending_approval" && canDecide && (
                <>
                  <button className="primary-button" type="button" disabled={busy !== null} onClick={() => actions.decideApproval(plan.id, true)}>
                    <Check size={15} /> {busy === "decide" ? "Recording…" : "Approve migration"}
                  </button>
                  <button className="secondary-button" type="button" disabled={busy !== null} onClick={() => actions.decideApproval(plan.id, false)}>
                    <X size={15} /> Reject
                  </button>
                </>
              )}
              {plan.status === "pending_approval" && !canDecide && (
                <span className="muted-copy">Awaiting decision from an owner or issuer administrator.</span>
              )}
              {plan.status === "approved" && (
                <>
                  <button className="primary-button" type="button" disabled={busy !== null} onClick={() => actions.executeOnChain(plan.id)}>
                    <Check size={15} /> {busy === "chain" ? "Submitting on chain…" : "Execute on chain"}
                  </button>
                  <button className="secondary-button" type="button" disabled={busy !== null} onClick={() => actions.executePlan(plan.id)}>
                    {busy === "execute" ? "Recording…" : "Record simulated execution"}
                  </button>
                </>
              )}
              {(plan.status === "executing" || plan.status === "uncertain") && (
                <span className="muted-copy">
                  <CircleSlash2 size={13} /> Execution outcome is {plan.status}; reconciliation is required before any retry.
                </span>
              )}
              {plan.status === "resolved" && (
                <button className="primary-button" type="button" onClick={onOpenReceipts}>
                  <FileCheck2 size={15} /> View audit receipt
                </button>
              )}
              {plan.status === "cancelled" && (
                <span className="muted-copy">This plan was rejected. Create a new plan to remediate.</span>
              )}
            </div>

            {isDemo && (
              <div className="demo-callout">
                DEMO SCENARIO — positions and the incident are seeded. "Execute on chain" submits a real
                transaction to the configured chain and issues a receipt bound to its hash; "Record simulated
                execution" does not.
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
