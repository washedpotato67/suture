import { useMemo, useState } from "react";
import { AlertTriangle, RotateCw, ShieldCheck } from "lucide-react";
import type { PreflightResult, WorkspaceAsset } from "../domain/types";
import type { WorkspaceWallet } from "../lib/data";
import { StatusBadge } from "./StatusBadge";

interface PreflightProps {
  assets: WorkspaceAsset[];
  wallets: WorkspaceWallet[];
  result: PreflightResult | null;
  busy: boolean;
  error: string | null;
  connected: boolean;
  onRun: (input: { asset: WorkspaceAsset; wallet: WorkspaceWallet; action: string }) => void;
}

export function Preflight({ assets, wallets, result, busy, error, connected, onRun }: PreflightProps) {
  const [assetId, setAssetId] = useState(assets[0]?.id ?? "");
  const [walletId, setWalletId] = useState(wallets[0]?.id ?? "");
  const [action, setAction] = useState("transfer");
  const asset = useMemo(() => assets.find((item) => item.id === assetId) ?? assets[0], [assetId, assets]);
  const wallet = useMemo(() => wallets.find((item) => item.id === walletId) ?? wallets[0], [walletId, wallets]);
  const decisionTone = result?.decision === "PASS" ? "good" : result?.decision === "BLOCK" ? "bad" : "warn";

  return <section className="workspace-stack">
    <section className="panel">
      <div className="panel-heading compact"><div><h2>Policy preflight</h2><p>Server-authoritative policy evaluation before a consequential action.</p></div>{result && <StatusBadge tone={decisionTone}>{result.decision}</StatusBadge>}</div>
      <div className="preflight-form">
        <label>Source asset<select value={asset?.id ?? ""} onChange={(event) => setAssetId(event.target.value)}>{assets.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        <label>Wallet<select value={wallet?.id ?? ""} onChange={(event) => setWalletId(event.target.value)}>{wallets.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        <label>Proposed action<select value={action} onChange={(event) => setAction(event.target.value)}><option value="transfer">Transfer</option><option value="deposit">Deposit</option><option value="collateralize">Collateralize</option><option value="borrow">Borrow</option><option value="restricted_exit">Restricted exit</option></select></label>
      </div>
      <div className="plan-actions"><button className="primary-button" type="button" disabled={busy || !asset || !wallet || !connected} onClick={() => asset && wallet && onRun({ asset, wallet, action })}><ShieldCheck size={15} />{busy ? "Evaluating…" : "Run server preflight"}</button>{!connected && <span className="muted-copy">A connected session is required for a provider evaluation.</span>}</div>
      {error && <div className="form-error" role="alert"><AlertTriangle size={15} /> {error} Retry after the local function route is available.</div>}
    </section>
    <section className="panel">
      <div className="panel-heading compact"><div><h2>Decision record</h2><p>{result ? `${result.source === "server" ? "Server result" : "Simulated fixture"} at ${new Date(result.evaluatedAt).toLocaleString()}` : "No server decision recorded."}</p></div>{result && <StatusBadge tone={result.evidenceState === "verified" ? "good" : "warn"}>{result.evidenceState.toUpperCase()}</StatusBadge>}</div>
      {!result && <p className="muted-copy">Select an asset and wallet, then request the server evaluation. Browser state never decides compliance.</p>}
      {result && <div className="check-list">{result.checks.map((check) => <div className="check-row" key={check.id}><span className={`check-dot check-${check.status}`} /><div><strong>{check.label}</strong><small>{check.detail}</small><small>{check.checkedAt ? new Date(check.checkedAt).toLocaleString() : "timestamp unavailable"} · evidence {check.evidenceState}</small></div><code>{check.reasonCode}</code></div>)}</div>}
      {result?.providerReferences.length ? <p className="muted-copy">Provider request references were stored server-side. Response bodies are not exposed in the browser.</p> : null}
      {result?.requiredRemediationPaths.length ? <div className="inspector-warning"><RotateCw size={15} /><span>{result.requiredRemediationPaths.map((path) => `${path.action}: ${path.reasonCode}`).join(" · ")}</span></div> : null}
    </section>
  </section>;
}
