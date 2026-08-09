import type { ReactNode } from "react";

export function StatusBadge({ tone, children }: { tone: "good" | "warn" | "bad" | "muted"; children: ReactNode }) {
  return <span className={`status-badge status-${tone}`}>{children}</span>;
}
