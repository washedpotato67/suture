---
name: SUTURE
description: Compliance that survives composition — an incident board for tokenized-asset compliance.
colors:
  flap-black: "#0d0d0f"
  flap-shadow: "#1b1b1e"
  flap-white: "#f2f2f2"
  delay-amber: "#ffb400"
  amber-bright: "#ffc233"
  cancelled-red: "#d32f2f"
  platform-green: "#3fae6a"
  steel-frame: "#8b8b92"
  steel-dark: "#7d858c"
  concourse-ink: "#8a8578"
  hinge-line: "rgba(0,0,0,.55)"
  cell-inset: "rgba(0,0,0,.35)"
  badge-inset: "rgba(0,0,0,.5)"
typography:
  scale:
    micro: "7.5px"
    track: "8px"
    label: "8.5px"
    caption: "9px"
    note: "9.5px"
    stamp: "10px"
    figure: "12px"
    nav: "14px"
    row: "15px"
    section: "17px"
    station: "18px"
    brand: "19px"
    panel: "20px"
    auth: "21px"
    plan: "22px"
    board-header: "24px"
    readout: "26px"
  flap:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontWeight: 500
    letterSpacing: "0.08em"
  body:
    fontFamily: "'Barlow', system-ui, sans-serif"
    fontSize: "13px"
    lineHeight: 1.55
  data:
    fontFamily: "'IBM Plex Mono', monospace"
    fontSize: "11px"
rounded:
  xs: "1px"
  sm: "2px"
  md: "4px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.delay-amber}"
    textColor: "{colors.flap-black}"
    rounded: "{rounded.sm}"
    padding: "10px 16px"
  button-secondary:
    backgroundColor: "{colors.flap-shadow}"
    textColor: "{colors.flap-white}"
    rounded: "{rounded.sm}"
    padding: "10px 16px"
---

# Design System: SUTURE

## Overview

**Creative North Star: "The Concourse Board"**

The console is a rail concourse split-flap board at rush hour. Compliance state is not
visualized, it is *posted*: positions are departures, statuses flip on the board, and every
change cascades down the flaps in one mechanical ripple. The world is dark steel, flap-black
cells, warm off-white capitals, and signal color used the way a concourse uses it — amber for
attention, red for cancelled, green for the one shuttle that gets you home.

Motion is the product's voice. A static SUTURE screen is a board between announcements; the
signature moment is the cascade — a status change sweeping a row character by character. Every
flap is a recorded event: append-only, truthful, labeled when the data is demo.

**Key Characteristics:**
- Split-flap cells with a visible horizontal split line and per-character cascade animation
- Condensed all-caps grotesque for everything the board "posts"; mono only for identifiers and figures
- Signal color discipline: amber = attention/action, red = non-compliant, green = resolved/repair
- The lineage graph is the posted strip map beside the board — stations on a line, not floating cards
- Receipts are issued tickets; approvals are stamped on the board, never implied by UI state

## Colors

Signal colors on a flap-black board; color is information, never decoration.

### Primary
- **Delay Amber** (`{colors.delay-amber}`): attention and consequential action — blocked states, awaiting approval, the primary commit button. The board's way of saying "look here now."

### Secondary
- **Cancelled Red** (`{colors.cancelled-red}`): revoked, failed, non-compliant. Reserved for states that demand intervention.
- **Platform Green** (`{colors.platform-green}`): the repair path and resolved states — the replacement-wallet shuttle, executed remediations, valid credentials.

### Neutral
- **Flap Black** (`{colors.flap-black}`): the board ground; every surface is this or one step up.
- **Flap Shadow** (`{colors.flap-shadow}`): cell interiors and secondary fills.
- **Flap White** (`{colors.flap-white}`): posted text; the board's chalk.
- **Steel Frame / Steel Dark** (`{colors.steel-frame}`, `{colors.steel-dark}`): borders, frames, dividers — the board's housing.
- **Concourse Ink** (`{colors.concourse-ink}`): muted annotations, timestamps, track numbers.

### Named Rules
**The Signal Discipline Rule.** Amber, red, and green each carry exactly one meaning (attention,
non-compliant, repair/resolved). They never appear as accents, brand color, or decoration. If a
screen uses signal color where no state changed, the screen is wrong.

## Typography

**Flap Font:** Barlow Condensed (Arial Narrow fallback) — everything the board posts: nav,
headings, statuses, buttons. Always uppercase, letter-spaced (0.08em).
**Body Font:** Barlow (system-ui fallback) — the few sentences of long-form copy.
**Data Font:** IBM Plex Mono — wallet addresses, hashes, amounts, timestamps, reason codes.

**Character:** a concourse posts in condensed capitals and stamps figures in mono; nothing else
exists. Sentence-case prose is confined to descriptions and helper text.

### Hierarchy
- **Board Header** (500, 20–28px, uppercase): view titles and section headers, posted like a destination.
- **Flap Row** (500, 15–17px, uppercase, per-character cells): statuses, positions, plan states.
- **Title** (600, 15px): card and panel headings.
- **Body** (400, 13px, sentence case): summaries and helper copy, max ~70ch.
- **Label** (500, 10px, 0.12em tracking, uppercase, concourse-ink): field labels, eyebrows, column headers.

### Named Rules
**The Posted Rule.** If text represents state, it is set in the flap face, uppercase, inside
cells. If it explains, it is body copy. The two never mix in one line.

## Layout

A board, not a grid of cards. Views compose as: concourse column (nav, 224px) + board surface.
The board surface stacks framed sections: a header strip with readouts, then rows. Rows are the
fundamental unit — every entity (position, incident, plan, receipt, provider) is a row with
fixed columns (time, name, value, status, track). Desktop rows are single-line; below 900px
rows stack into two lines and columns reflow to label-over-value. One spacing rhythm (8px base);
more space above a section header than below it.

## Elevation & Depth

Flat by construction — a flap board has no shadows. Depth is mechanical: cells sit one tone
above the board (`flap-shadow` on `flap-black`), the split line divides each cell, and lit rows
raise their background one step. The only glow permitted is the amber row-lamp beside an active
or attention row.

## Shapes

Square-shouldered: 2px radius on cells and buttons, 4px on framed sections. Every flap cell
carries a 1px horizontal split line at mid-height (the flap hinge). Buttons are rectangular
plates. No pills, no soft cards, no rounded avatars — the operator mark is a square steel plate
with initials.

## Components

### Buttons
- **Shape:** rectangular plate (2px radius), flap face, uppercase.
- **Primary (consequential):** delay-amber plate, flap-black text (10px 16px padding). Used only for actions that change recorded state — request, approve, execute.
- **Secondary:** flap-shadow plate, flap-white text, steel-dark border.
- **Hover/Focus:** hover raises brightness one step; focus gets a 2px amber outline offset 2px.

### Flap Row (signature)
- Single-line row of per-character cells; each cell is flap-shadow on flap-black with the hinge
  line; statuses set in signal color. On value change the row cascades: characters flip in
  sequence (steps() keyframes, ~40ms stagger). Disabled under `prefers-reduced-motion` —
  text swaps instantly.

### Board Section
- Framed panel: flap-black ground, steel-dark 1px frame, header bar with section title in flap
  caps and a readout on the right. Sections never nest.

### Strip Map (lineage)
- The posted route diagram: one horizontal line, stations as ring ticks, interchange at the
  source. Cut sections are masked by suspension tape (board-ground dashes + amber label). The
  repair path is a platform-green dashed shuttle line. Positions are selectable stations.

### Ticket (audit receipt)
- A receipt renders as an issued ticket: header route (source → replacement), perforated
  divider, hash as the ticket code in mono, payload as stamped fields. Expanded detail tears
  open below the perforation.

### Inputs / Fields
- Flap-shadow plate, steel-dark border, flap-white text; focus border turns delay-amber. Labels
  are concourse-ink label caps above the field.

### Navigation
- Concourse column: station-sign list. Active item is a lit row — flap-shadow fill, white text,
  amber row-lamp dot. Counts post as track numbers.

## Do's and Don'ts

### Do:
- **Do** make every state change visible as a board event — cascade the row, flip the status.
- **Do** keep demo labeling posted on the board itself (DEMO DATA reads like a service notice).
- **Do** use mono for anything an auditor would copy: hashes, addresses, amounts, codes.
- **Do** let one amber element own attention per view.

### Don't:
- **Don't** use signal colors decoratively — they are state, not brand.
- **Don't** introduce shadows, glass, gradients, or rounded-soft card language.
- **Don't** set state text in sentence case or body font; the board posts in capitals.
- **Don't** animate ambiently; motion happens when the record changes, never on a loop.
- **Don't** imply a live provider, chain call, or verification the product has not performed.
