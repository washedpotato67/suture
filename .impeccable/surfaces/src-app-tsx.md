---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/styles.css","src/components/Overview.tsx","src/components/Incidents.tsx","src/components/LineageGraph.tsx"]
---

# Surface brief: SUTURE console (React app shell)

Primary target: `src/App.tsx`. Related: `src/styles.css`, `src/components/Overview.tsx`, `src/components/Incidents.tsx`, `src/components/LineageGraph.tsx`, `src/components/Receipts.tsx`, `src/components/Integrations.tsx`, `src/components/AuthGate.tsx`, `src/components/FlapText.tsx`.

## What this surface is

The issuer-side compliance operations console: a single-page board with a concourse
nav column and five views (Overview, Position Lineage, Incidents, Audit Receipts,
Integrations). It runs in two modes — connected (Supabase auth via `AuthGate`) and
demo (deterministic local fixtures, every screen labeled DEMO DATA).

## Direction contract (summary)

Creative North Star: **The Concourse Board** — a rail concourse split-flap departure
board. State is *posted*, not visualized. Full contract: `DESIGN.md` +
`.impeccable/design.json`; binding contract comment at the top of `src/styles.css`.

- Palette: flap-black `#0d0d0f` ground, flap-shadow `#1b1b1e` cells, flap-white
  `#f2f2f2` posted text; signal color only for state — delay-amber `#ffb400`
  (attention/action), cancelled-red `#d32f2f` (non-compliant), platform-green
  `#3fae6a` (repair/resolved).
- Type: Barlow Condensed uppercase for everything posted; IBM Plex Mono for
  identifiers/figures; Barlow for the rare body sentence.
- Flat by construction: no shadows, glass, or soft cards. Depth = one tone step +
  the 1px hinge line inside each flap cell.
- Motion: per-character flap cascade (`steps(2,end)` 0.16s, 38ms stagger) fires only
  when a posted value changes; disabled under `prefers-reduced-motion`.

## Signature components

- `FlapText` (`src/components/FlapText.tsx`): per-character hinged cells, re-keyed by
  content. Used for metric readouts, board statuses, plan states.
- Strip map (`src/components/LineageGraph.tsx`): lineage rendered as a posted route
  diagram — stations on line segments, suspension tape over cut sections, green
  dashed shuttle to the replacement wallet.
- Board table (`.board-table` in Incidents): blast-radius positions as departures rows.
- Status chips (`.status-badge` + `.flap-char` tones): state is signal-colored text
  inside cells, never decoration.

## Gotchas

- `.metric-card > span` (not `.metric-card span`) styles the caption — a descendant
  selector previously overridden `.flap-char` display and stacked the readouts
  vertically. Keep flap internals safe from bare-element selectors.
- Views are React state, not routes; screenshot automation must flip the initial
  `useState<View>` or drive the nav.
- Demo mode must never imply a live provider/chain call; the TRUTHFULNESS notice on
  Integrations and DEMO DATA badges are load-bearing.
