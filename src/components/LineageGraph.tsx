import { useMemo, useState } from "react";
import { AlertTriangle, Check, CircleSlash2, GitBranch } from "lucide-react";
import { calculateBlastRadius } from "../domain/lineage";
import type { Incident, LineageEdge, LineageNode } from "../domain/types";
import { formatUsd } from "../lib/data";
import { StatusBadge } from "./StatusBadge";
import { Select } from "./Select";

const width = 960;
const height = 430;
const STATION_R = 13;

type Tone = "ok" | "warn" | "bad";

function nodeTone(node: LineageNode): Tone {
  if (node.state === "blocked") return "bad";
  if (node.state === "at_risk") return "warn";
  return "ok";
}

interface LineageGraphProps {
  nodes: LineageNode[];
  edges: LineageEdge[];
  incident: Incident | null;
  onOpenIncident: () => void;
}

export function LineageGraph({ nodes, edges, incident, onOpenIncident }: LineageGraphProps) {
  const sourceId = incident?.sourceNodeId && nodes.some((node) => node.id === incident.sourceNodeId)
    ? incident.sourceNodeId
    : nodes[0]?.id ?? "";
  const blast = useMemo(
    () => (sourceId ? calculateBlastRadius(sourceId, nodes, edges) : null),
    [sourceId, nodes, edges],
  );
  const [selectedId, setSelectedId] = useState(sourceId);
  const [filter, setFilter] = useState<"all" | "at_risk" | "blocked">("all");
  const visibleNodes = filter === "all" ? nodes : nodes.filter((node) => node.id === sourceId || node.state === filter);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const selected = visibleNodes.find((node) => node.id === selectedId) ?? visibleNodes[0];

  if (nodes.length === 0 || !selected || !blast) {
    return (
      <section className="panel">
        <div className="eyebrow"><GitBranch size={13} /> POSITION LINEAGE</div>
        <p className="muted-copy">No positions recorded yet.</p>
      </section>
    );
  }

  const nodeById = new Map(visibleNodes.map((node) => [node.id, node]));
  const incidentOpen = incident !== null && incident.status !== "resolved";

  // The posted strip map: stations on a line, suspension tape over suspended segments.
  const segments = edges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to))
    .map((edge) => {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (!from || !to) return null;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const suspended = to.state === "blocked" || from.state === "blocked";
      return {
        edge,
        x1: from.x + ux * (STATION_R + 3),
        y1: from.y + uy * (STATION_R + 3),
        x2: to.x - ux * (STATION_R + 3),
        y2: to.y - uy * (STATION_R + 3),
        midX: (from.x + to.x) / 2,
        midY: (from.y + to.y) / 2,
        suspended,
      };
    })
    .filter((segment): segment is NonNullable<typeof segment> => segment !== null);

  const firstTape = segments.find((segment) => segment.suspended);
  const labelAbove = (node: LineageNode) => node.kind === "debt";

  return (
    <section className="panel lineage-panel" aria-labelledby="lineage-title">
      <div className="panel-heading">
        <div>
          <div className="eyebrow"><GitBranch size={13} /> POSITION LINEAGE</div>
          <h2 id="lineage-title">
            {incidentOpen
              ? `NSPC line — service suspended at ${blast.affectedNodeIds.length} stations`
              : "NSPC line — all stations in service"}
          </h2>
        </div>
        <div className="heading-actions">
          <Select label="Filter" className="graph-filter" value={filter}
            onChange={(next) => setFilter(next as typeof filter)}
            options={[
              { value: "all", label: "All positions" },
              { value: "at_risk", label: "At risk" },
              { value: "blocked", label: "Blocked" },
            ]} />
          {incidentOpen && <StatusBadge tone="bad">{incident.severity.toUpperCase()} INCIDENT</StatusBadge>}
        </div>
      </div>

      <div className="lineage-layout">
        <div className="graph-wrap" role="img" aria-label="Strip map of the position lineage: stations for each position, tape over suspended segments, and a shuttle line to the replacement wallet.">
          <svg viewBox={`0 0 ${width} ${height}`} className="lineage-svg">
            {/* line segments */}
            {segments.map((segment) => (
              <g key={segment.edge.id}>
                <line
                  x1={segment.x1} y1={segment.y1} x2={segment.x2} y2={segment.y2}
                  className={`map-line ${segment.suspended ? "" : "map-line-ok"}`}
                />
                {segment.suspended && (
                  <line x1={segment.x1} y1={segment.y1} x2={segment.x2} y2={segment.y2} className="map-tape" />
                )}
                <text x={segment.midX} y={segment.midY - 12} className="map-edge-label">
                  {segment.edge.action.toUpperCase()}
                </text>
              </g>
            ))}

            {firstTape && (
              <text x={firstTape.midX} y={firstTape.midY + 24} className="map-annotation" textAnchor="middle">
                SERVICE SUSPENDED — CREDENTIAL REVOKED
              </text>
            )}

            {/* repair shuttle to the replacement wallet */}
            <path d="M 90 210 L 90 356 L 300 356" className="map-shuttle" />
            <circle cx="300" cy="356" r="10" fill="#0a0a0c" stroke="var(--green)" strokeWidth="4" />
            <text x="322" y="352" className="station-label">REPLACEMENT WALLET</text>
            <text x="322" y="366" className="station-meta">SHUTTLE · DEPARTS ON ISSUER APPROVAL</text>

            {/* stations */}
            {visibleNodes.map((node) => {
              const tone = nodeTone(node);
              const isSelected = selectedId === node.id;
              const above = labelAbove(node);
              const labelY = above ? node.y - 26 : node.y + 34;
              return (
                <g
                  key={node.id}
                  className={`station-group ${isSelected ? "station-selected" : ""}`}
                  onClick={() => setSelectedId(node.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedId(node.id); }}
                >
                  {isSelected && (
                    <circle cx={node.x} cy={node.y} r={STATION_R + 7} fill="none" stroke="var(--flap-white)" strokeWidth="1" strokeDasharray="3 4" />
                  )}
                  <circle cx={node.x} cy={node.y} r={STATION_R} className={`station-ring station-${tone}`} />
                  <circle cx={node.x} cy={node.y} r={3.5} className="station-core" />
                  <text x={node.x + STATION_R + 9} y={above ? labelY : labelY - 8} className="station-label">
                    {node.label.toUpperCase()}
                  </text>
                  <text x={node.x + STATION_R + 9} y={above ? labelY + 12 : labelY + 6} className="station-meta">
                    {formatUsd(node.amountUsd)} · {node.policyVersion}
                  </text>
                  <text x={node.x + STATION_R + 9} y={above ? labelY + 26 : labelY + 20} className="station-state" fill={tone === "bad" ? "var(--red)" : tone === "warn" ? "var(--amber)" : "var(--green)"}>
                    {node.state.replaceAll("_", " ").toUpperCase()}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="graph-summary">
            <div><span>AFFECTED VALUE</span><strong>{formatUsd(blast.affectedValueUsd)}</strong></div>
            <div><span>STATIONS</span><strong>{blast.affectedNodeIds.length}</strong></div>
            <div><span>POLICY</span><strong>{selected.policyVersion}</strong></div>
          </div>
        </div>

        <aside className="node-inspector" aria-label="Selected position details">
          <div className="eyebrow">SELECTED STATION</div>
          <h3>{selected.label}</h3>
          <p>{selected.subtitle}</p>
          <dl>
            <div><dt>Value</dt><dd>{formatUsd(selected.amountUsd)}</dd></div>
            <div><dt>Wallet</dt><dd className="mono">{selected.ownerWallet}</dd></div>
            <div><dt>Policy version</dt><dd>{selected.policyVersion}</dd></div>
            <div><dt>Credential</dt><dd><StatusBadge tone={selected.credentialState === "valid" ? "good" : "bad"}>{selected.credentialState.toUpperCase()}</StatusBadge></dd></div>
            <div><dt>Evidence</dt><dd><StatusBadge tone={selected.evidenceState === "verified" ? "good" : "warn"}>{selected.evidenceState.toUpperCase()}</StatusBadge></dd></div>
          </dl>
          <div className="inspector-warning">
            {selected.state === "blocked" ? <CircleSlash2 size={16} /> : <AlertTriangle size={16} />}
            <span>{selected.state === "blocked" ? "New movement is blocked." : "This position requires remediation."}</span>
          </div>
          {incident && (
            <button className="secondary-button" type="button" onClick={onOpenIncident}>
              <Check size={15} /> Review incident
            </button>
          )}
        </aside>
      </div>
    </section>
  );
}
