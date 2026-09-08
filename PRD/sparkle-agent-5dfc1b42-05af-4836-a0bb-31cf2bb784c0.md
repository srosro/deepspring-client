# Progress — branch `sparkle/agent-5dfc1b42-05af-4836-a0bb-31cf2bb784c0`

## Progress Update as of 2026-09-08 (Pacific)
*(Most recent updates at top)*

### Summary of changes since last update

Branch carries three reporter test-reliability fixes, all green in CI and waiting
on the human merge gate. A fourth change — a pre-POST badge-drift check — was
added and then reverted after review found it duplicated PR #89, which implements
the same feature and touches the same file. This entry is the first progress doc
on the branch; it back-fills the whole history rather than only the last commit.

### Detail of changes made:

- **Branch origin matters for anyone picking this up.** This branch was originally
  cut from an orphan root commit (`aaf4d44`, a `bd init` scaffolding root) that
  shares no history with `origin/main` — `git merge-base origin/main <branch>`
  returned nothing, so nothing on it could ever merge. It was re-anchored onto
  `origin/main` before any work began. Ten other `sparkle/agent-*` branches plus
  local `master` are still pinned to that orphan (`builder-index-client-fy6`).
- **`8e0f117` — host isolation for agentsview resolution (`builder-index-client-trk`).**
  `agentsviewCandidates()` probed `/opt/homebrew/bin/agentsview` and
  `/usr/local/bin/agentsview` unconditionally. Those absolute paths were the only
  part of resolution that `HOME` / `PATH` / `AGENTSVIEW_BIN` isolation could not
  reach, so five tests asserting "no binary available" resolved the developer's own
  install and failed on any machine that had one. `AGENTSVIEW_SYSTEM_CANDIDATES`
  now replaces the list (unset = documented defaults, empty = none) and the two
  isolating suites empty it.
- **`1d508e5` — pin the Node major the native addon is built for (`builder-index-client-cvq`).**
  better-sqlite3 ships prebuilds for one Node major, and which one lived only in a
  comment in `ci.yml`. Added `.nvmrc` (22) and `engines`, plus `reporter/sqlite.ts`,
  which translates ABI-mismatch failures into a sentence naming the running Node,
  the pinned Node and the remedy (original preserved as `cause`).
  `test/toolchain.test.ts` fails if `.nvmrc`, `engines` and `ci.yml` disagree.
  Deliberately does **not** bump better-sqlite3 — a native-dependency major is a
  human's call, and that is the half that would make `npm test` run on node 26.
- **`d7bba6c` — a raced assertion (`builder-index-client-0ux`).** The failed-sync
  case read the fake binary's call log expecting exactly `["sync"]`; in the timeout
  branch the kill can land before `/bin/sh` reaches its first write. Measured
  pass/fail/fail across three runs of an identical build.
- **`1e559ec` then `58c1b8a` — badge-drift check, added and reverted (−336 LOC).**
  Reverted after review: it duplicated PR #89 and conflicts on `reporter/report.ts`.
  It also carried a real bug the reviewer caught — the HTTP status was discarded, so
  a JSON error body would parse into empty lists and announce every configured badge
  as new. #89 owns this feature; findings were passed to it in a PR comment.
- **`d4f58d4` — review response.** Blocking probe fixed: `test/cursor.test.ts` opened
  better-sqlite3 directly, so the suite most likely to meet a mismatched Node still
  got the cryptic message; it goes through `openDatabase` now and no direct
  constructor remains in the suite. The failed-sync fake now logs *after* its sync
  branch, so the log records only a usage call and the conditional machinery is
  gone. README's `:`-delimiter claim corrected to the platform `PATH` delimiter.

Measured on node 26.4.0 with a real agentsview at `/usr/local/bin`:
276 tests / 240 pass / 32 fail → 290 / 259 / 27. Every remaining failure is the
better-sqlite3 addon, each now naming its own cause.

### Beads activity:
- Fixed, awaiting merge: `builder-index-client-trk`, `builder-index-client-0ux`
- Partly addressed, left open by design: `builder-index-client-cvq` (dependency
  bump is a human call)
- Opened: `builder-index-client-fy6` (orphan-root branches),
  `builder-index-client-0ux` (the flake)
- Linked as already-fixed so no one duplicates them: `builder-index-client-4ed`,
  `builder-index-client-wb0`, `builder-index-client-1xp`
- Investigated and left open with reasoning: `builder-index-client-cko` (no home in
  this repo — the guidance belongs in agent instruction files gated on
  `builder-index-client-e5s`)
- Recurrence recorded: `builder-index-client-fu8` (merge protection surfaced only at
  merge time)

### Potential concerns to address:
- The branch cannot self-land: this repo is merge-protected and no agent may run
  `gh pr merge`. Tracked as `builder-index-client-uyu`.
- Two agents built the badge-drift feature in parallel without either knowing
  (#85 and #89). Nothing in the bead or PR flow surfaced the overlap; a reviewer
  caught it. Worth a claim-time branch record on beads.
- An open reviewer question stands on PR #85: whether `AGENTSVIEW_BIN` should become
  authoritative-when-set, which would delete `AGENTSVIEW_SYSTEM_CANDIDATES` entirely.
  Declined here because it reverses a deliberate existing fallback pinned by a
  pre-existing test; it is a product call, and the offer to make the change is open
  on the PR.
