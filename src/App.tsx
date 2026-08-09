import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BadgeCheck,
  Boxes,
  Building2,
  FileClock,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Siren,
  X,
} from "lucide-react";
import { calculateBlastRadius, type BlastRadius } from "./domain/lineage";
import { assertTransition, executePlan, hashReceiptPayload } from "./domain/remediation";
import type { AuditReceipt, PreflightResult, RemediationPlan } from "./domain/types";
import { ActivityAudit } from "./components/ActivityAudit";
import { Assets } from "./components/Assets";
import { AuthGate } from "./components/AuthGate";
import { Incidents, type RemediationActions } from "./components/Incidents";
import { Integrations } from "./components/Integrations";
import { LineageGraph } from "./components/LineageGraph";
import { Onboarding } from "./components/Onboarding";
import { Overview } from "./components/Overview";
import { Preflight } from "./components/Preflight";
import { Remediation } from "./components/Remediation";
import { SettingsPanel } from "./components/SettingsPanel";
import { StatusBadge } from "./components/StatusBadge";
import {
  demoWorkspace,
  hasOrganization,
  loadWorkspace,
  rpcDecideApproval,
  rpcExecutePlan,
  rpcRequestApproval,
  runServerPreflight,
  runChainExecutor,
  type WorkspaceData,
} from "./lib/data";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import { useSession } from "./lib/useSession";

type View = "overview" | "assets" | "lineage" | "preflight" | "incidents" | "remediation" | "audit" | "integrations" | "settings";

const navigation: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "assets", label: "Assets", icon: Boxes },
  { id: "lineage", label: "Lineage", icon: GitBranch },
  { id: "preflight", label: "Preflight", icon: BadgeCheck },
  { id: "incidents", label: "Incidents", icon: Siren },
  { id: "remediation", label: "Remediation", icon: ShieldCheck },
  { id: "audit", label: "Audit", icon: FileClock },
  { id: "integrations", label: "Integrations", icon: Activity },
];

const EMPTY_BLAST: BlastRadius = {
  sourceNodeId: "",
  affectedNodeIds: [],
  affectedValueUsd: 0,
  paths: [],
};

/** Applies a remediation transition to fixture-mode state using the same rules as the RPCs. */
function applyDemoTransition(
  workspace: WorkspaceData,
  planId: string,
  change: (plan: RemediationPlan) => { plan: RemediationPlan; receipt?: AuditReceipt; resolveIncident?: boolean },
): WorkspaceData {
  const receiptExtras: AuditReceipt[] = [];
  let resolveIncident = false;
  const plans = workspace.plans.map((plan) => {
    if (plan.id !== planId) return plan;
    const result = change(plan);
    if (result.receipt) receiptExtras.push(result.receipt);
    if (result.resolveIncident) resolveIncident = true;
    return result.plan;
  });
  return {
    ...workspace,
    plans,
    receipts: [...receiptExtras, ...workspace.receipts],
    incident:
      resolveIncident && workspace.incident
        ? { ...workspace.incident, status: "resolved" }
        : workspace.incident,
  };
}

function App() {
  const { session, loading: sessionLoading } = useSession();
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [preflightResult, setPreflightResult] = useState<PreflightResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<View>("overview");
  const [mobileNav, setMobileNav] = useState(false);

  const userId = session?.user.id ?? null;

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setWorkspace((current) => current ?? demoWorkspace());
      return;
    }
    if (!userId) return;
    if (!(await hasOrganization(userId))) {
      setNeedsOnboarding(true);
      setWorkspace(null);
      return;
    }
    setNeedsOnboarding(false);
    setWorkspace(await loadWorkspace(userId));
  }, [userId]);

  useEffect(() => {
    setLoadError(null);
    refresh().catch((cause) =>
      setLoadError(cause instanceof Error ? cause.message : "Failed to load workspace"),
    );
  }, [refresh]);

  const blast = useMemo<BlastRadius>(() => {
    if (!workspace || workspace.nodes.length === 0) return EMPTY_BLAST;
    const incidentSource = workspace.incident?.sourceNodeId;
    const sourceId =
      incidentSource && workspace.nodes.some((node) => node.id === incidentSource)
        ? incidentSource
        : workspace.nodes[0]!.id;
    return calculateBlastRadius(sourceId, workspace.nodes, workspace.edges);
  }, [workspace]);

  const runAction = useCallback(
    (kind: string, action: () => Promise<void>) => {
      setBusy(kind);
      setActionError(null);
      action()
        .catch((cause) =>
          setActionError(cause instanceof Error ? cause.message : "Action failed"),
        )
        .finally(() => setBusy(null));
    },
    [],
  );

  const actions: RemediationActions = {
    requestApproval: (planId) =>
      runAction("request", async () => {
        if (workspace?.mode === "connected") {
          await rpcRequestApproval(planId);
          await refresh();
        } else {
          setWorkspace((current) =>
            current
              ? applyDemoTransition(current, planId, (plan) => {
                  assertTransition(plan.status, "pending_approval");
                  return { plan: { ...plan, status: "pending_approval" } };
                })
              : current,
          );
        }
      }),
    decideApproval: (planId, approve) =>
      runAction("decide", async () => {
        if (workspace?.mode === "connected") {
          await rpcDecideApproval(planId, approve);
          await refresh();
        } else {
          setWorkspace((current) =>
            current
              ? applyDemoTransition(current, planId, (plan) => {
                  assertTransition(plan.status, approve ? "approved" : "cancelled");
                  return {
                    plan: approve
                      ? { ...plan, status: "approved", approvedAt: new Date().toISOString() }
                      : { ...plan, status: "cancelled" },
                  };
                })
              : current,
          );
        }
      }),
    executeOnChain: (planId) =>
      runAction("chain", async () => {
        if (workspace?.mode !== "connected") throw new Error("On-chain execution requires a connected session");
        const result = await runChainExecutor(planId);
        await refresh();
        if (result.state === "confirmed") {
          setActionError(null);
        } else {
          // Not an error: an uncertain or unconfigured outcome is a real state
          // that must be surfaced rather than silently retried.
          setActionError(
            `Chain execution state: ${result.state}${result.txHash ? ` · tx ${result.txHash.slice(0, 12)}…` : ""}${result.detail ? ` · ${result.detail}` : ""}`,
          );
        }
      }),
    executePlan: (planId) =>
      runAction("execute", async () => {
        if (workspace?.mode === "connected") {
          await rpcExecutePlan(planId);
          await refresh();
        } else {
          const currentPlan = workspace?.plans.find((plan) => plan.id === planId);
          if (!workspace?.incident || !currentPlan) {
            throw new Error("Remediation plan or incident is unavailable");
          }
          const executedAt = new Date().toISOString();
          const receiptHash = await hashReceiptPayload(currentPlan, workspace.incident, executedAt);
          setWorkspace((current) => {
            if (!current?.incident) return current;
            return applyDemoTransition(current, planId, (plan) => {
              const result = executePlan(
                plan,
                current.incident!,
                current.receipts,
                executedAt,
                receiptHash,
              );
              return { plan: result.plan, receipt: result.receipt, resolveIncident: true };
            });
          });
        }
      }),
  };

  const runPreflight = (input?: { asset: WorkspaceData["assets"][number]; wallet: WorkspaceData["wallets"][number]; action: string }) =>
    runAction("preflight", async () => {
      const asset = input?.asset ?? workspace?.assets[0];
      const wallet = input?.wallet ?? workspace?.wallets[0];
      const action = input?.action ?? "transfer";
      if (!workspace || !asset || !wallet) throw new Error("A source asset and wallet are required for preflight");
      if (workspace?.mode === "connected") {
        if (!workspace.organizationId || !asset.activePolicyVersionId) throw new Error("Active policy context is unavailable. Refresh the workspace and retry.");
        setPreflightResult(await runServerPreflight({ organizationId: workspace.organizationId, walletId: wallet.id, sourceAssetId: asset.id, policyVersionId: asset.activePolicyVersionId, action }));
        return;
      }
      setPreflightResult({
        source: "fixture", decision: workspace.checks.some((check) => check.status === "fail") ? "BLOCK" : "PASS", action,
        checks: workspace.checks.map((check) => ({ ...check, checkedAt: new Date().toISOString(), evidenceState: check.evidenceState === "asserted" ? "simulated" : check.evidenceState })),
        reasonCodes: workspace.checks.filter((check) => check.status !== "pass").map((check) => check.reasonCode),
        evaluatedAt: new Date().toISOString(), evidenceState: "simulated", providerReferences: [], requiredRemediationPaths: [{ action: "wallet_migration", reasonCode: "DEMO_APPROVAL_REQUIRED" }],
        recovery: "Deterministic fixture only. No provider or chain request was made.",
      });
    });

  if (sessionLoading) {
    return <div className="auth-shell"><p className="muted-copy">Restoring session…</p></div>;
  }
  if (isSupabaseConfigured && !session) {
    return <AuthGate />;
  }
  if (isSupabaseConfigured && needsOnboarding) {
    return <Onboarding onCreated={() => void refresh()} />;
  }
  if (!workspace) {
    return (
      <div className="auth-shell">
        {loadError
          ? <p className="form-error" role="alert">{loadError}</p>
          : <p className="muted-copy">Loading workspace…</p>}
      </div>
    );
  }

  const incident = workspace.incident;
  const plan = workspace.plans.find((candidate) => candidate.incidentId === incident?.id) ?? workspace.plans[0] ?? null;
  const incidentOpen = incident !== null && incident.status !== "resolved";
  const operatorLabel = session?.user.email ?? "Demo Operator";
  const viewTitle =
    view === "overview" ? "Compliance operations"
    : view === "lineage" ? "Position lineage"
    : view === "audit" ? "Audit log"
    : view.charAt(0).toUpperCase() + view.slice(1);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 8h12" stroke="#ffb400" strokeWidth="1.4"/>
              <path d="M4 5.5v5M8 5.5v5M12 5.5v5" stroke="#f2f2f2" strokeWidth="1.4"/>
            </svg>
          </div>
          <div><strong>SUTURE</strong><small>COMPLIANCE CONTINUITY</small></div>
          <button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>
        <button className="org-switcher" type="button">
          <Building2 size={16} />
          <span><strong>{workspace.organizationName}</strong><small>Issuer workspace</small></span>
        </button>
        <nav aria-label="Primary navigation">
          <div className="nav-label">OPERATIONS</div>
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={view === item.id ? "nav-active" : ""} onClick={() => { setView(item.id); setMobileNav(false); }}>
                <Icon size={16} /> {item.label}
                {item.id === "incidents" && incidentOpen && <span className="nav-count">1</span>}
              </button>
            );
          })}
          <div className="nav-label">ADMINISTRATION</div>
          <button className={view === "settings" ? "nav-active" : ""} onClick={() => { setView("settings"); setMobileNav(false); }}><Settings size={16} /> Settings</button>
        </nav>
        <div className="sidebar-footer">
          <div className="operator-avatar">{operatorLabel.slice(0, 2).toUpperCase()}</div>
          <div>
            <strong>{operatorLabel}</strong>
            <small>{workspace.role ? workspace.role.replaceAll("_", " ") : "Compliance operator"}</small>
          </div>
          {isSupabaseConfigured && (
            <button className="icon-button" type="button" aria-label="Sign out" title="Sign out" onClick={() => void supabase?.auth.signOut()}>
              <LogOut size={15} />
            </button>
          )}
        </div>
      </aside>

      <main>
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={19} /></button>
          <div>
            <div className="breadcrumb">{workspace.organizationName.split("—")[0]?.trim().toUpperCase()} / {view.toUpperCase()}</div>
            <h1>{viewTitle}</h1>
          </div>
          <div className="topbar-status">
            {workspace.isDemo && <StatusBadge tone="muted">DEMO DATA</StatusBadge>}
            <StatusBadge tone={workspace.mode === "connected" ? "good" : "warn"}>
              {workspace.mode === "connected" ? "SUPABASE CONNECTED" : "LOCAL DEMO"}
            </StatusBadge>
          </div>
        </header>

        <div className="content">
          <section className="product-intro">
            <div>
              <div className="eyebrow">COMPLIANCE THAT SURVIVES COMPOSITION.</div>
              <p>Trace every derived position. Repair every broken policy path.</p>
            </div>
            <button className="secondary-button" type="button" disabled={busy !== null} onClick={() => setView("preflight")}>
              <BadgeCheck size={15} /> {busy === "preflight" ? "Running…" : "Run policy preflight"}
            </button>
          </section>

          {actionError && <div className="form-error" role="alert">{actionError}</div>}

          {view === "overview" && (
            <>
              <Overview
                nodes={workspace.nodes}
                incident={incident}
                plan={plan}
                checks={workspace.checks}
                integrations={workspace.integrations}
                blast={blast}
                isDemo={workspace.isDemo}
                assets={workspace.assets}
                activity={workspace.activity}
                approvals={workspace.approvals}
                onOpenIncident={() => setView("incidents")}
              />
              <LineageGraph nodes={workspace.nodes} edges={workspace.edges} incident={incident} onOpenIncident={() => setView("incidents")} />
            </>
          )}
          {view === "lineage" && (
            <LineageGraph nodes={workspace.nodes} edges={workspace.edges} incident={incident} onOpenIncident={() => setView("incidents")} />
          )}
          {view === "assets" && <Assets assets={workspace.assets} nodes={workspace.nodes} onOpenLineage={() => setView("lineage")} />}
          {view === "preflight" && <Preflight assets={workspace.assets} wallets={workspace.wallets} result={preflightResult} busy={busy === "preflight"} error={actionError} connected={workspace.mode === "connected"} onRun={(input) => runPreflight(input)} />}
          {view === "incidents" && (
            incident ? (
              <Incidents
                incident={incident}
                plan={plan}
                nodes={workspace.nodes}
                blast={blast}
                wallets={workspace.wallets}
                role={workspace.role}
                isDemo={workspace.isDemo}
                busy={busy}
                actions={actions}
                onOpenReceipts={() => setView("audit")}
              />
            ) : (
              <section className="panel"><p className="muted-copy">No incident on record for this organization.</p></section>
            )
          )}
          {view === "remediation" && <Remediation incident={incident} plan={plan} approvals={workspace.approvals} nodes={workspace.nodes} blast={blast} wallets={workspace.wallets} role={workspace.role} isDemo={workspace.isDemo} busy={busy} actions={actions} onOpenReceipts={() => setView("audit")} />}
          {view === "audit" && <ActivityAudit activity={workspace.activity} receipts={workspace.receipts} isDemo={workspace.isDemo} />}
          {view === "integrations" && <Integrations integrations={workspace.integrations} />}
          {view === "settings" && <SettingsPanel role={workspace.role} />}
        </div>
      </main>
    </div>
  );
}

export default App;
