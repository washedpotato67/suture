import { useState } from "react";
import { GitBranch } from "lucide-react";
import type { LineageNode, WorkspaceAsset } from "../domain/types";
import { formatUsd } from "../lib/data";
import { StatusBadge } from "./StatusBadge";

export function Assets({ assets, nodes, onOpenLineage }: { assets: WorkspaceAsset[]; nodes: LineageNode[]; onOpenLineage: () => void }) {
  const [selectedId, setSelectedId] = useState(assets[0]?.id ?? "");
  const selected = assets.find((asset) => asset.id === selectedId) ?? assets[0];
  const positions = nodes.filter((node) => selected?.positionIds.includes(node.id));
  return <section className="workspace-stack">
    <section className="panel"><div className="panel-heading compact"><div><h2>Assets</h2><p>Issuer assets with their inherited policy context and stored evidence.</p></div><StatusBadge tone="muted">{assets.length} MONITORED</StatusBadge></div><div className="board-table"><div className="board-table-header"><span>Asset</span><span>Policy</span><span>Evidence</span><span>Positions</span></div>{assets.map((asset) => <button className={`board-table-row table-button ${selected?.id === asset.id ? "table-selected" : ""}`} key={asset.id} type="button" onClick={() => setSelectedId(asset.id)}><span>{asset.label}<small>{asset.assetReference}</small></span><span>{asset.activePolicyVersion}</span><span><StatusBadge tone={asset.evidenceState === "verified" ? "good" : "warn"}>{asset.evidenceState.toUpperCase()}</StatusBadge></span><span>{asset.positionIds.length}</span></button>)}</div></section>
    {selected && <section className="two-column"><article className="panel"><div className="panel-heading compact"><div><h2>{selected.label}</h2><p>Cleanverse reference: {selected.assetReference}</p></div><StatusBadge tone="muted">{selected.activePolicyVersion}</StatusBadge></div><dl className="detail-list"><div><dt>Policy hash</dt><dd className="mono">{selected.policyHash ?? "unavailable"}</dd></div><div><dt>Evidence</dt><dd>{selected.evidenceState}</dd></div><div><dt>Represented exposure</dt><dd>{formatUsd(positions.reduce((sum, item) => sum + item.amountUsd, 0))}</dd></div></dl><button className="secondary-button" type="button" onClick={onOpenLineage}><GitBranch size={15} /> Open asset lineage</button></article><article className="panel"><div className="panel-heading compact"><div><h2>Policy history</h2><p>Immutable versions surfaced from the policy record.</p></div></div><div className="check-list">{selected.policyHistory.map((policy) => <div className="check-row" key={policy.version}><span className="check-dot check-pass" /><div><strong>{policy.version}</strong><small>{policy.effectiveAt ? new Date(policy.effectiveAt).toLocaleString() : "effective time unavailable"}</small></div><code>{policy.policyHash ?? "hash unavailable"}</code></div>)}</div></article></section>}
  </section>;
}
