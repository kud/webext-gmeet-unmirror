# webext-gmeet-unmirror — project plan

A Firefox WebExtension that hides the **presentation tile** on a Google Meet call so
that sharing your whole screen no longer produces the infinite "hall of mirrors" effect.

This file is a self-contained handoff. A fresh Claude session opened in this folder
should be able to build the extension from here without re-deriving anything.

---

## Problem

When you present in Google Meet on Firefox and share the **entire screen** (rather than a
single window or tab), Firefox hands Meet the whole monitor surface. Meet then paints your
own presentation feed back into a tile inside the page — and because that tile is on the
screen you're sharing, it gets captured and re-rendered, recursively. Result: an infinite
nested mirror of your presentation.

Firefox cannot exclude its own window from a full-screen capture (`getDisplayMedia` shares
the whole surface), so the problem **cannot** be solved at the screen-capture layer. But the
mirror is a **DOM rendering artefact**: it only exists because Meet draws the presentation
into a visible element. Hide that one element and the recursion has nothing to feed on.

## Use cases

- Presenter on a single-monitor Mac, sharing the full screen because they need to switch
  between apps, wants to keep seeing participants (so "minimise Firefox" is unacceptable)
  but kill the mirror.
- Quick mid-call toggle: hide the presentation tile the moment the mirror appears, show it
  again when needed — without leaving the call or fumbling with Meet's pin/spotlight UI.

## The hard requirement (correctness bar)

**Hide ONLY the presentation feed.** Never hide:

- the user's own self-view (face) thumbnail,
- other participants' video tiles,
- Meet's controls / chat / people panel.

Getting this wrong (hiding the face or participants) makes the extension useless. Every
selector decision below is in service of this constraint.

## Scope

**In:**

- Content script injected on `*://meet.google.com/*`.
- A floating toggle button overlaid on the Meet page (always present — the robust fallback).
- Keyboard shortcut to toggle hands-free mid-call (e.g. `Alt+Shift+H`).
- Auto-hide: detect when a screen-share starts and hide the presentation tile automatically,
  with the button as an override to un-hide.
- Hiding replaces the presentation tile with a labelled placeholder ("Presentation hidden —
  unmirror") so the presenter knows the hide is intentional.

**Out (for v1):**

- Chrome / other browsers (Firefox-only; AMO release).
- Zoom / Teams / other conferencing apps.
- Any options/settings UI beyond the toggle + shortcut (revisit if needed).
- Native messaging, background network calls — none required.

## Behaviour: build BOTH modes for v1

The user explicitly wants to ship both the **manual toggle** and the **auto-hide** and judge
which feels right against real Meet behaviour. The manual button is the always-available
safety net; auto-hide is the delightful path that depends on reliably detecting a share.

- **Mode 1 — manual toggle + shortcut:** floating button + `Alt+Shift+H` flip the hidden state.
- **Mode 2 — auto-hide on share:** when a screen-share begins, hide automatically; button
  becomes the un-hide override.

Both act on the same "hide the presentation tile" primitive — build that once, wire two
triggers to it.

---

## Technical design

### Manifest / platform

- **Manifest V3**, with `browser_specific_settings.gecko.id` set (AMO requires a stable id).
- Permissions: host match `*://meet.google.com/*` only. No `tabs`, no `activeTab`, no broad host perms.
- Content script auto-injected at `document_idle` on the Meet host.
- Keyboard shortcut: simplest robust route is a `keydown` listener **inside the content
  script** (no background service worker, no `commands` API, no cross-context messaging).
  The `commands` API is the "proper" route (shows in about:addons shortcut UI) but adds a
  background worker + message plumbing — defer unless the in-page listener proves flaky.

### The core primitive — `hidePresentationTile()` / `showPresentationTile()`

Meet's class names are randomised, so selection must be resilient:

1. **Primary heuristic — largest visible video.** Enumerate `document.querySelectorAll('video')`,
   filter to those with a non-zero rendered bounding box that are actually on screen, pick the
   one with the largest area. When presenting, the presentation is the spotlighted main stage,
   so it is the largest video; the self-view is a small thumbnail and participants are smaller.
   This size asymmetry is what keeps the face safe.
2. **Backstop signal — MUST be confirmed against a live Meet call during dev.** Refine the
   pick with a stable attribute on the presentation tile. Candidates to inspect for:
   an `aria-label` / text containing "presentation" or (localised) "présentation";
   a data attribute distinguishing a screen-share tile from a camera tile. Do NOT hardcode a
   guessed selector — open a real call, present, inspect the tile, and pin the real signal.
3. **Walk up** from the chosen `<video>` to its tile container (the element Meet lays out in
   the grid) and toggle a class `gmeet-unmirror-hidden` on it.
4. Injected CSS for that class: `visibility: hidden` (keeps the box in layout so the grid
   doesn't reflow) and overlay a placeholder child reading "Presentation hidden — unmirror".
   Prefer `visibility`/placeholder over `display:none` to avoid Meet re-layout thrash.
5. Toggling re-runs detection each time (the DOM changes across the call lifecycle).

### Auto-hide detection (Mode 2)

Two candidate signals — start with (a), keep (b) as the more reliable upgrade:

- **(a) MutationObserver on the DOM (stays in content-script world, no MAIN-world needed):**
  watch for the presentation tile appearing / the "you are presenting" state. Cheaper, no
  page-context injection, but relies on DOM signals that need live confirmation.
- **(b) Monkey-patch `navigator.mediaDevices.getDisplayMedia` (needs MAIN world):** the most
  reliable "a share just started" signal, but requires injecting into the page's context
  (`world: "MAIN"` content script, or an injected `<script>`), since the isolated content-script
  world has its own `navigator`. Adopt if the MutationObserver approach proves unreliable.

Auto-hide should always be overridable by the button (user un-hides → stay un-hidden until
next explicit action).

### Known fragile point

The single risk is selector drift as Meet ships UI changes. Mitigations: the largest-video
heuristic is language- and class-name-independent; the button is always present as a manual
fallback; keep the tile-finding logic in one small, well-named function that's easy to re-pin.

---

## Decisions already made

- **Name:** `webext-gmeet-unmirror` (repo + folder), following the fleet's type-prefix
  convention (`mcp-*` → `webext-*`). The user-facing extension name stays `gmeet-unmirror`;
  the `g` scopes it to Google Meet.
- **Browser:** Firefox only, AMO release. (@kud webext conventions.)
- **Both behaviour modes** ship in v1 (manual toggle + shortcut AND auto-hide), button as fallback.
- **Hide only the presentation** — never self-view or participants (the correctness bar).
- **Hide mechanism:** `visibility:hidden` + labelled placeholder, not `display:none`.
- **No background worker for v1** if the in-content-script keydown listener suffices.

## Open questions

- Exact stable selector/attribute for the presentation tile — resolve by inspecting a **live**
  Meet call while presenting; do not guess.
- Keyboard shortcut default (`Alt+Shift+H` proposed) — confirm no clash with Meet's own hotkeys.
- Auto-hide signal: MutationObserver (simple) vs `getDisplayMedia` hook (reliable, MAIN world) —
  decide after testing (a) against a real call.
- MV3 vs MV2 on Firefox — default MV3 per current AMO guidance; fall back only if a specific
  API forces it.

## Next steps

1. Open a fresh Claude session **inside this folder** (`~/Projects/webext-gmeet-unmirror/`).
2. Route through the build door: `/k-project` (it owns the `webext-scaffolder` orchestration),
   or ask directly for the `webext-scaffolder` agent. Hand it this `plan.md`.
3. Scaffold the @kud Firefox WebExtension (manifest, web-ext tooling, AMO release pipeline, CI).
4. Implement `hidePresentationTile` / `showPresentationTile` with the largest-video heuristic.
5. Load in Firefox via `web-ext run`, join a real Meet call, present, and **confirm on a live
   call**: (a) the mirror is broken, (b) the self-view and participants stay visible, (c) pin
   the real presentation-tile selector signal.
6. Wire the three triggers (button, shortcut, auto-hide) to the core primitive.
7. Iterate on auto-hide detection against real share start/stop.
