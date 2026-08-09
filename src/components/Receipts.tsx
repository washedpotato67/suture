import { useState } from "react";
import { ChevronDown, ChevronRight, FileClock } from "lucide-react";
import type { AuditReceipt } from "../domain/types";
import { shortWallet } from "../lib/data";
import { StatusBadge } from "./StatusBadge";

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" && value.startsWith("0x")) return shortWallet(value);
  return String(value);
}

export function Receipts({ receipts, isDemo }: { receipts: AuditReceipt[]; isDemo: boolean }) {
  const [openId, setOpenId] = useState<string | null>(receipts[0]?.id ?? null);

  return (
    <section className="panel">
      <div className="panel-heading compact">
        <div>
          <div className="eyebrow"><FileClock size={13} /> AUDIT RECEIPTS</div>
          <h2>Immutable execution evidence</h2>
        </div>
        <StatusBadge tone="muted">{receipts.length} ISSUED</StatusBadge>
      </div>

      {receipts.length === 0 && (
        <p className="muted-copy">
          No receipts yet. A receipt is issued when an approved remediation plan is executed.
        </p>
      )}

      <div className="receipt-list">
        {receipts.map((receipt) => {
          const open = openId === receipt.id;
          return (
            <div className="receipt-item" key={receipt.id}>
              <button
                type="button"
                className="receipt-head"
                onClick={() => setOpenId(open ? null : receipt.id)}
                aria-expanded={open}
              >
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <div>
                  <strong>{String(receipt.payload.action ?? "remediation").replaceAll("_", " ")}</strong>
                  <small>issued {new Date(receipt.issuedAt).toLocaleString()}</small>
                </div>
                <code>{receipt.receiptHash.slice(0, 16)}…</code>
              </button>
              {open && (
                <dl className="detail-list receipt-detail">
                  <div><dt>Receipt hash (SHA-256)</dt><dd className="mono">{receipt.receiptHash}</dd></div>
                  <div><dt>Incident</dt><dd className="mono">{receipt.incidentId}</dd></div>
                  <div><dt>Plan</dt><dd className="mono">{receipt.planId}</dd></div>
                  {Object.entries(receipt.payload).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key.replaceAll("_", " ")}</dt>
                      <dd className="mono">{renderValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          );
        })}
      </div>

      {isDemo && receipts.length > 0 && (
        <div className="demo-callout">DEMO DATA — receipts document a simulated migration.</div>
      )}
    </section>
  );
}
