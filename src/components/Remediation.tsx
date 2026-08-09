import { ShieldCheck } from "lucide-react";
import type { ApprovalRecord, Incident, RemediationPlan } from "../domain/types";
import type { OrgRole, WorkspaceWallet } from "../lib/data";
import { Incidents, type RemediationActions } from "./Incidents";
import type { BlastRadius } from "../domain/lineage";
import type { LineageNode } from "../domain/types";

export function Remediation({ incident, plan, approvals, nodes, blast, wallets, role, isDemo, busy, actions, onOpenReceipts }: { incident: Incident | null; plan: RemediationPlan | null; approvals: ApprovalRecord[]; nodes: LineageNode[]; blast: BlastRadius; wallets: WorkspaceWallet[]; role: OrgRole | null; isDemo: boolean; busy: string | null; actions: RemediationActions; onOpenReceipts: () => void }) {
  if (!incident) return <section className="panel"><h2>Remediation</h2><p className="muted-copy">No incident requires a policy-authorized recovery path.</p></section>;
  return <section className="workspace-stack"><section className="panel"><div className="panel-heading compact"><div><h2>Policy-authorized remediation</h2><p>Only an owner or issuer administrator records an approval. SUTURE does not claim provider migration support.</p></div><ShieldCheck size={18} /></div><div className="check-list">{approvals.length ? approvals.map((approval) => <div className="check-row" key={approval.id}><span className="check-dot check-pass" /><div><strong>{approval.requiredRole} {approval.decision}</strong><small>{new Date(approval.decidedAt).toLocaleString()}{approval.note ? ` · ${approval.note}` : ""}</small></div></div>) : <p className="muted-copy">No approval record yet. The plan remains gated.</p>}</div></section><Incidents incident={incident} plan={plan} nodes={nodes} blast={blast} wallets={wallets} role={role} isDemo={isDemo} busy={busy} actions={actions} onOpenReceipts={onOpenReceipts} /></section>;
}
