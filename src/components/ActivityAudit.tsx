import { Download, Printer } from "lucide-react";
import type { ActivityEvent, AuditReceipt } from "../domain/types";
import { Receipts } from "./Receipts";

function redact(value: unknown): unknown {
  if (typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value)) return `${value.slice(0, 6)}…${value.slice(-4)}`;
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redact(entry)]));
  return value;
}

export function ActivityAudit({ activity, receipts, isDemo }: { activity: ActivityEvent[]; receipts: AuditReceipt[]; isDemo: boolean }) {
  const download = () => { const value = JSON.stringify(redact({ exportedAt: new Date().toISOString(), activity, receipts }), null, 2); const href = URL.createObjectURL(new Blob([value], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = href; anchor.download = "suture-audit-export.json"; anchor.click(); URL.revokeObjectURL(href); };
  return <section className="workspace-stack"><section className="panel"><div className="panel-heading compact"><div><h2>Audit log</h2><p>Tenant-scoped activity. Addresses are not exposed in this export.</p></div><div className="heading-actions"><button className="secondary-button" type="button" onClick={() => window.print()}><Printer size={14} /> Print</button><button className="secondary-button" type="button" onClick={download}><Download size={14} /> Download</button></div></div><div className="check-list">{activity.length ? activity.map((event) => <div className="check-row" key={event.id}><span className="check-dot check-pass" /><div><strong>{event.eventType.replaceAll("_", " ")}</strong><small>{event.detail}</small></div><code>{new Date(event.occurredAt).toLocaleString()} · {event.evidenceState}</code></div>) : <p className="muted-copy">No audit events are available under this member session.</p>}</div></section><Receipts receipts={receipts} isDemo={isDemo} /></section>;
}
