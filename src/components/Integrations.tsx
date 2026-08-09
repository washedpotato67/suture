import { Activity } from "lucide-react";
import type { IntegrationStatus } from "../domain/types";
import { StatusBadge } from "./StatusBadge";

export function Integrations({ integrations }: { integrations: IntegrationStatus[] }) {
  return (
    <section className="panel">
      <div className="panel-heading compact">
        <div>
          <div className="eyebrow"><Activity size={13} /> INTEGRATION BOUNDARY</div>
          <h2>Provider connections</h2>
        </div>
        <StatusBadge tone="muted">{integrations.length} PROVIDERS</StatusBadge>
      </div>
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
      <div className="demo-callout">
        TRUTHFULNESS — simulated adapters are deterministic and local. No Cleanverse request, Monad RPC
        request, contract deployment, or on-chain transaction has been executed from this console.
      </div>
    </section>
  );
}
