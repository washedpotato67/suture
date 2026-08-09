import { Activity, AlertOctagon, Boxes, FileCheck2, ShieldAlert } from "lucide-react";
import type { BlastRadius } from "../domain/lineage";
import type {
  Incident,
  ActivityEvent,
  ApprovalRecord,
  IntegrationStatus,
  LineageNode,
  PolicyCheckResult,
  RemediationPlan,
  WorkspaceAsset,
} from "../domain/types";
import { formatUsd } from "../lib/data";
import { FlapText } from "./FlapText";
import { StatusBadge } from "./StatusBadge";

interface OverviewProps {
  nodes: LineageNode[];
  incident: Incident | null;
  plan: RemediationPlan | null;
  checks: PolicyCheckResult[];
  integrations: IntegrationStatus[];
  blast: BlastRadius;
  isDemo: boolean;
  assets: WorkspaceAsset[];
  activity: ActivityEvent[];
  approvals: ApprovalRecord[];
  onOpenIncident: () => void;
}

function compactUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return formatUsd(value);
}

export function Overview({
  nodes,
  incident,
  plan,
  checks,
  integrations,
  blast,
  isDemo,
  assets: monitoredAssets,
  activity,
  approvals,
  onOpenIncident,
}: OverviewProps) {
  const assets = monitoredAssets.length;
  const protocolCount = new Set(nodes.map((node) => node.protocolName).filter(Boolean)).size;
  const compliant = nodes.filter((node) => node.state === "healthy").length;
  const review = nodes.filter((node) => node.state === "at_risk").length;
  const blocked = nodes.filter((node) => node.state === "blocked").length;
  const incidentOpen = incident !== null && incident.status !== "resolved";

  const metrics = [
    { label: "Assets monitored", value: String(assets), detail: `${monitoredAssets.filter((asset) => asset.activePolicyVersion !== "unavailable").length} active policies`, icon: Boxes },
    { label: "Derived positions", value: String(nodes.length - nodes.filter((node) => node.kind === "asset").length), detail: `${protocolCount} protocols`, icon: Activity },
    { label: "Exposure at risk", value: compactUsd(blast.affectedValueUsd), detail: `${blast.affectedNodeIds.length} affected nodes`, icon: ShieldAlert },
    { label: "Open incidents", value: incidentOpen ? "1" : "0", detail: incident ? incident.severity : "none", icon: AlertOctagon },
  ];

  const sequenceState = (step: number): "complete" | "active" | "" => {
    if (!incident) return "";
    if (!plan) return step <= 2 ? "complete" : step === 3 ? "active" : "";
    switch (plan.status) {
      case "draft":
        return step <= 2 ? "complete" : step === 3 ? "active" : "";
      case "pending_approval":
        return step <= 3 ? "complete" : step === 4 ? "active" : "";
      case "approved":
      case "executing":
      case "uncertain":
      case "resolved":
        return "complete";
      default:
        return step <= 2 ? "complete" : "";
    }
  };

  return (
    <>
      <section className="metric-grid" aria-label="Portfolio summary">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          const alert = metric.label === "Open incidents" && metric.value !== "0";
          return (
            <article key={metric.label} className={`metric-card ${alert ? "metric-alert" : ""}`}>
              <div className="metric-label"><Icon size={13} /> {metric.label}</div>
              <strong><FlapText text={metric.value} /></strong>
              <span>{metric.detail}</span>
            </article>
          );
        })}
      </section>

      <section className="status-strip" aria-label="Compliance state counts"><span>COMPLIANT <strong>{compliant}</strong></span><span>REVIEW <strong>{review}</strong></span><span>BLOCKED <strong>{blocked}</strong></span><span>APPROVALS <strong>{approvals.length}</strong></span><span>PLANS <strong>{plan ? 1 : 0}</strong></span></section>
      <section className="two-column">
        <article className="panel incident-card">
          <div className="panel-heading compact">
            <div>
              <div className="eyebrow"><AlertOctagon size={13} /> {incidentOpen ? "ACTIVE INCIDENT" : "INCIDENT"}</div>
              <h2>{incident?.title ?? "No incident on record"}</h2>
            </div>
            {incident && <StatusBadge tone={incidentOpen ? "bad" : "good"}>{incidentOpen ? incident.severity.toUpperCase() : "RESOLVED"}</StatusBadge>}
          </div>
          {incident && (
            <>
              <p>{incident.summary}</p>
              <div className="incident-sequence">
                <div className={`sequence-item ${sequenceState(1)}`}><span>1</span><div><strong>Revocation received</strong><small>Source holder credential is no longer valid.</small></div></div>
                <div className={`sequence-item ${sequenceState(2)}`}><span>2</span><div><strong>Blast radius calculated</strong><small>{blast.affectedNodeIds.length} positions identified from stored lineage.</small></div></div>
                <div className={`sequence-item ${sequenceState(3)}`}><span>3</span><div><strong>Movement blocked</strong><small>New deposit, transfer, and redemption fail preflight.</small></div></div>
                <div className={`sequence-item ${sequenceState(4)}`}><span>4</span><div><strong>Approval and recovery</strong><small>{plan?.status === "resolved" ? "Migration executed and receipted." : "Replacement-wallet migration requires issuer approval."}</small></div></div>
              </div>
              <button type="button" className="primary-button" onClick={onOpenIncident}>Open incident console</button>
            </>
          )}
        </article>

        <article className="panel">
          <div className="panel-heading compact">
            <div>
              <div className="eyebrow"><FileCheck2 size={13} /> POLICY PREFLIGHT</div>
              <h2>Proposed receipt transfer</h2>
            </div>
            <StatusBadge tone={checks.some((check) => check.status === "fail") ? "bad" : "good"}>
              {checks.some((check) => check.status === "fail") ? "BLOCKED" : "ALLOWED"}
            </StatusBadge>
          </div>
          <div className="check-list">
            {checks.map((check) => (
              <div className="check-row" key={check.id}>
                <span className={`check-dot check-${check.status}`} />
                <div><strong>{check.label}</strong><small>{check.detail}</small></div>
                <code>{check.reasonCode}</code>
              </div>
            ))}
          </div>
          {isDemo && <div className="demo-callout">DEMO DATA — no Cleanverse or Monad request was executed.</div>}
        </article>
      </section>

      <section className="panel"><div className="panel-heading compact"><div><h2>Recent activity</h2><p>Only persisted tenant events are shown.</p></div></div><div className="check-list">{activity.length ? activity.slice(0, 5).map((event) => <div className="check-row" key={event.id}><span className="check-dot check-pass" /><div><strong>{event.eventType.replaceAll("_", " ")}</strong><small>{event.detail}</small></div><code>{new Date(event.occurredAt).toLocaleString()} · {event.evidenceState}</code></div>) : <p className="muted-copy">No recent activity is recorded.</p>}</div></section>

      <section className="panel integration-strip">
        <div><div className="eyebrow">INTEGRATION BOUNDARY</div><h2>Provider status</h2></div>
        <div className="integration-list">
          {integrations.map((integration) => (
            <div key={integration.name} className="integration-item">
              <span className="integration-light" />
              <div><strong>{integration.name}</strong><small>{integration.detail}</small></div>
              <StatusBadge tone={integration.state === "connected" ? "good" : integration.state === "simulated" ? "muted" : "warn"}>
                {integration.state.toUpperCase()}
              </StatusBadge>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
