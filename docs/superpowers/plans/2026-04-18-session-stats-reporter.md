# tkmx-client session-stats reporter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shell out to `agentsview session stats --format json` from the reporter daemon and pass through the result as `body.session_stats` on `POST /api/usage`. Add transition-marker logic so flipping `REPORT_DEV_STATS=false` or `REPORT_SESSION_STATS=false` sends an explicit clear signal to tkmx-server once.

**Architecture:** One new collector module (`reporter/session-stats.js`) that matches the existing CommonJS + `execFileSync` pattern used by `reporter/agentsview.js` and the per-agent collectors. One new persistent-state module (`reporter/reporting-state.js`) that tracks whether each stats category was "on" on the previous run so the daemon can emit one-shot clear signals on transitions.

**Tech Stack:** Node.js (CommonJS), existing `execFileSync` + `resolveAgentsview` helpers, JSON file for state persistence.

**Spec reference:** `~/code/tkmx-server/docs/superpowers/specs/2026-04-18-session-analytics-design.md` — "tkmx-client changes" and "Client-side opt-out" sections.

**Prerequisites:**
- agentsview PR merged and locally installed (`~/.local/bin/agentsview`) so `agentsview session stats --format json --since 28d` works.
- tkmx-server PR merged or running locally with the `clear_dev_stats` and `session_stats` ingest paths in place.

---

## File structure

| File | Responsibility |
|------|----------------|
| `reporter/session-stats.js` | New — `collectSessionStats()` shell-out to agentsview |
| `reporter/reporting-state.js` | New — persistent transition marker (`{ dev_stats_on, session_stats_on }`) |
| `reporter/report.js` | Modify — wire in the new collector; implement transition-marker logic; decide what to include in POST body |
| `test/session-stats.test.js` | New — collector smoke test (fake agentsview binary) |
| `test/reporting-state.test.js` | New — transition-marker unit tests |

---

## Task ordering

Sequential — each task depends on the prior. Four phases:

- **Phase 1 (T1–T2):** The collector (`reporter/session-stats.js`) in isolation.
- **Phase 2 (T3–T4):** The state-file module for transition markers.
- **Phase 3 (T5–T6):** Wire everything into `report.js` including the transition logic.
- **Phase 4 (T7):** End-to-end smoke with a real agentsview.

---

## Phase 1 — Collector

### Task 1: Write the collector module with test

**Files:**
- Create: `reporter/session-stats.js`
- Create: `test/session-stats.test.js`

- [ ] **Step 1: Create a fake agentsview fixture for tests.**

Create `test/fixtures/fake-agentsview` with executable permissions:

```bash
#!/usr/bin/env bash
# Emits a minimal v1 session_stats blob when invoked with 'session stats'.
if [[ "$1" == "session" && "$2" == "stats" ]]; then
  cat <<'JSON'
{"schema_version":1,"window":{"days":28},"totals":{"sessions_all":10},"generated_at":"2026-04-18T00:00:00Z"}
JSON
  exit 0
fi
echo "unexpected args: $*" >&2
exit 2
```

```bash
chmod +x test/fixtures/fake-agentsview
```

- [ ] **Step 2: Write the failing test.**

```javascript
// test/session-stats.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

test("collectSessionStats returns parsed JSON from agentsview", () => {
  process.env.AGENTSVIEW_BIN = path.join(__dirname, "fixtures", "fake-agentsview");
  const { collectSessionStats } = require("../reporter/session-stats");
  const out = collectSessionStats({ sinceDays: 28 });
  assert.ok(out);
  assert.equal(out.schema_version, 1);
  assert.equal(out.totals.sessions_all, 10);
});

test("collectSessionStats returns null when binary missing", () => {
  process.env.AGENTSVIEW_BIN = "/definitely/not/here";
  // Clear require cache so AGENTSVIEW_BIN env override is re-read.
  delete require.cache[require.resolve("../reporter/session-stats")];
  delete require.cache[require.resolve("../reporter/agentsview")];
  const { collectSessionStats } = require("../reporter/session-stats");
  const out = collectSessionStats({ sinceDays: 28 });
  assert.equal(out, null);
});

test("collectSessionStats returns null on non-JSON output", () => {
  const brokenPath = path.join(__dirname, "fixtures", "broken-agentsview");
  require("node:fs").writeFileSync(brokenPath,
    "#!/usr/bin/env bash\necho 'garbage' && exit 0\n", { mode: 0o755 });
  process.env.AGENTSVIEW_BIN = brokenPath;
  delete require.cache[require.resolve("../reporter/session-stats")];
  delete require.cache[require.resolve("../reporter/agentsview")];
  const { collectSessionStats } = require("../reporter/session-stats");
  const out = collectSessionStats({ sinceDays: 28 });
  assert.equal(out, null);
});
```

- [ ] **Step 3: Run tests → FAIL** (module doesn't exist yet).

```bash
node --test test/session-stats.test.js
```

- [ ] **Step 4: Write the implementation.**

```javascript
// reporter/session-stats.js
const { execFileSync } = require("node:child_process");
const { resolveAgentsview } = require("./agentsview");

const DEFAULT_TIMEOUT_MS = 180_000;  // 3 minutes — git integration can be slow
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

// collectSessionStats runs `agentsview session stats --format json` and returns
// the parsed blob, or null on any error (missing binary, non-zero exit,
// non-JSON output). Errors are logged but never propagate — the reporter
// treats session stats as a best-effort addition and must keep working.
function collectSessionStats({ sinceDays = 28, timezone, ghToken } = {}) {
  const bin = resolveAgentsview();
  if (!bin) {
    console.error("[session-stats] agentsview binary not found; skipping");
    return null;
  }
  const args = ["session", "stats", "--format", "json", "--since", `${sinceDays}d`];
  if (timezone) args.push("--timezone", timezone);
  if (ghToken)  args.push("--gh-token", ghToken);

  const execOpts = {
    encoding: "utf-8",
    maxBuffer: MAX_BUFFER_BYTES,
    timeout: DEFAULT_TIMEOUT_MS,
  };

  let raw;
  try {
    raw = execFileSync(bin, args, execOpts);
  } catch (err) {
    const stderr = (err.stderr && err.stderr.toString().trim()) || "";
    const detail = stderr ? `: ${stderr}` : `: ${err.message}`;
    console.error(`[session-stats] agentsview failed${detail}`);
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`[session-stats] JSON parse failed: ${err.message}`);
    return null;
  }

  if (!parsed || typeof parsed !== "object" || typeof parsed.schema_version !== "number") {
    console.error("[session-stats] unexpected output shape");
    return null;
  }
  return parsed;
}

module.exports = { collectSessionStats };
```

- [ ] **Step 5: Run tests → PASS.**

```bash
node --test test/session-stats.test.js
```

Expected: 3 passing.

- [ ] **Step 6: Commit.**

```bash
git add reporter/session-stats.js test/session-stats.test.js test/fixtures/fake-agentsview test/fixtures/broken-agentsview
git commit -m "reporter: add collectSessionStats that shells out to agentsview"
```

---

## Phase 2 — Persistent transition state

### Task 2: State-file module with test

**Files:**
- Create: `reporter/reporting-state.js`
- Create: `test/reporting-state.test.js`

- [ ] **Step 1: Write failing tests.**

```javascript
// test/reporting-state.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("loadState returns defaults when file absent", () => {
  const dir = fs.mkdtempSync("/tmp/tkmx-state-");
  const filePath = path.join(dir, "state.json");
  const { loadState } = require("../reporter/reporting-state");
  const state = loadState(filePath);
  assert.deepEqual(state, { dev_stats_on: false, session_stats_on: false });
});

test("saveState and loadState roundtrip", () => {
  const dir = fs.mkdtempSync("/tmp/tkmx-state-");
  const filePath = path.join(dir, "state.json");
  const { loadState, saveState } = require("../reporter/reporting-state");
  saveState(filePath, { dev_stats_on: true, session_stats_on: true });
  const loaded = loadState(filePath);
  assert.deepEqual(loaded, { dev_stats_on: true, session_stats_on: true });
});

test("computeTransitionMarkers: on→off emits clear signals", () => {
  const { computeTransitionMarkers } = require("../reporter/reporting-state");
  const prior = { dev_stats_on: true, session_stats_on: true };
  const current = { dev_stats_on: false, session_stats_on: false };
  const markers = computeTransitionMarkers(prior, current);
  assert.equal(markers.clear_dev_stats, true);
  assert.strictEqual(markers.session_stats, null);  // explicit null = clear
});

test("computeTransitionMarkers: steady-state off → no markers", () => {
  const { computeTransitionMarkers } = require("../reporter/reporting-state");
  const prior = { dev_stats_on: false, session_stats_on: false };
  const current = { dev_stats_on: false, session_stats_on: false };
  const markers = computeTransitionMarkers(prior, current);
  assert.equal(markers.clear_dev_stats, undefined);
  assert.equal("session_stats" in markers, false);
});

test("computeTransitionMarkers: steady-state on → no markers", () => {
  const { computeTransitionMarkers } = require("../reporter/reporting-state");
  const prior = { dev_stats_on: true, session_stats_on: true };
  const current = { dev_stats_on: true, session_stats_on: true };
  const markers = computeTransitionMarkers(prior, current);
  assert.equal(Object.keys(markers).length, 0);
});

test("computeTransitionMarkers: only dev_stats toggled", () => {
  const { computeTransitionMarkers } = require("../reporter/reporting-state");
  const prior = { dev_stats_on: true, session_stats_on: true };
  const current = { dev_stats_on: false, session_stats_on: true };
  const markers = computeTransitionMarkers(prior, current);
  assert.equal(markers.clear_dev_stats, true);
  assert.equal("session_stats" in markers, false);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.**

```javascript
// reporter/reporting-state.js
const fs = require("node:fs");

const DEFAULT_STATE = Object.freeze({ dev_stats_on: false, session_stats_on: false });

function loadState(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      dev_stats_on:     Boolean(parsed.dev_stats_on),
      session_stats_on: Boolean(parsed.session_stats_on),
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState(filePath, state) {
  const normalized = {
    dev_stats_on:     Boolean(state.dev_stats_on),
    session_stats_on: Boolean(state.session_stats_on),
  };
  fs.writeFileSync(filePath, JSON.stringify(normalized), "utf-8");
}

// computeTransitionMarkers returns the set of POST body fields that
// should be added to this report to signal the transition to tkmx-server.
// Only on→off transitions produce markers; on→on, off→on, and off→off
// do not.
function computeTransitionMarkers(prior, current) {
  const markers = {};
  if (prior.dev_stats_on && !current.dev_stats_on) {
    markers.clear_dev_stats = true;
  }
  if (prior.session_stats_on && !current.session_stats_on) {
    markers.session_stats = null;
  }
  return markers;
}

module.exports = { loadState, saveState, computeTransitionMarkers, DEFAULT_STATE };
```

- [ ] **Step 4: Run → PASS.**

```bash
node --test test/reporting-state.test.js
```

- [ ] **Step 5: Commit.**

```bash
git add reporter/reporting-state.js test/reporting-state.test.js
git commit -m "reporter: persistent transition-marker state for stats opt-out"
```

---

## Phase 3 — Wiring into the report flow

### Task 3: Integrate into `report.js` — collector + transition markers

**Files:**
- Modify: `reporter/report.js` (around line 278 where the dev-stats gating currently lives)

- [ ] **Step 1: Add imports and state-file path.**

At the top of the file (with the other requires):

```javascript
const path = require("node:path");
const { collectSessionStats } = require("./session-stats");
const { loadState, saveState, computeTransitionMarkers } = require("./reporting-state");

const STATE_PATH = path.join(__dirname, "..", ".reporting-state.json");
```

- [ ] **Step 2: In the main report flow, before building the POST body, load prior state and determine current enablement.**

```javascript
const priorState = loadState(STATE_PATH);
const currentState = {
  dev_stats_on:     process.env.REPORT_DEV_STATS === "true",
  session_stats_on: process.env.REPORT_SESSION_STATS !== "false"
                      && process.env.REPORT_DEV_STATS === "true",
  // session stats is gated behind the same top-level flag by default,
  // with an explicit off switch via REPORT_SESSION_STATS=false for users
  // who want behavioral dev_stats but not the richer analytics.
};
```

- [ ] **Step 3: Just before `await postUsage(...)`, compute and merge transition markers.**

```javascript
const markers = computeTransitionMarkers(priorState, currentState);
Object.assign(body, markers);
```

- [ ] **Step 4: Inside the existing `if (REPORT_DEV_STATS === "true")` block, add the session-stats collection.**

```javascript
if (currentState.session_stats_on) {
  console.log("  Collecting session stats (agentsview)...");
  const ss = collectSessionStats({
    sinceDays: Number(REPORT_DAYS) || 28,
    ghToken:   process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
  });
  if (ss) {
    body.session_stats = ss;
    console.log(`  Session stats: ${ss.totals?.sessions_all ?? "?"} sessions, schema v${ss.schema_version}`);
  }
}
```

- [ ] **Step 5: After `postUsage` completes successfully, persist the new state.**

```javascript
// Persist state only on successful POST — so a transition marker is
// retried on the next run if the POST failed.
if (response && response.ok !== false) {
  saveState(STATE_PATH, currentState);
}
```

- [ ] **Step 6: Smoke-run locally against your dev tkmx-server.**

```bash
# With stats on
REPORT_DEV_STATS=true AGENTSVIEW_BIN=$(which agentsview) \
  npm run report
# Verify body.session_stats was sent: check tkmx-server logs or:
sqlite3 ~/code/tkmx-server/dev.db \
  "SELECT json_extract(session_stats, '$.schema_version') FROM machines WHERE username='$USERNAME';"

# Now flip off — transition marker should clear both
REPORT_DEV_STATS=false npm run report
sqlite3 ~/code/tkmx-server/dev.db \
  "SELECT dev_stats, session_stats FROM machines WHERE username='$USERNAME';"
# Expect: dev_stats = '{}', session_stats = NULL

# Run again with stats off — no markers sent (check tkmx-server logs):
npm run report
# Server should not log any 'clear_dev_stats' warning this time.
```

- [ ] **Step 7: Commit.**

```bash
git add reporter/report.js
git commit -m "reporter: wire session-stats collector + transition-marker opt-out"
```

---

### Task 4: Add `.reporting-state.json` to `.gitignore` and docs

**Files:**
- Modify: `.gitignore`
- Modify: `README.md`

- [ ] **Step 1: Append to `.gitignore`.**

```
.reporting-state.json
```

- [ ] **Step 2: Document the new env vars** in README:
- `REPORT_SESSION_STATS=false` (optional, opt-out of session stats only while keeping dev stats)
- Behavior: flipping `REPORT_DEV_STATS` or `REPORT_SESSION_STATS` from on to off sends one clear signal to the server; subsequent reports omit the analytics fields.

- [ ] **Step 3: Commit.**

```bash
git add .gitignore README.md
git commit -m "docs: document session-stats opt-in and transition-marker behavior"
```

---

## Phase 4 — End-to-end verification

### Task 5: Manual end-to-end run

- [ ] **Step 1: Ensure agentsview branch + tkmx-server branch are merged or running locally.**

- [ ] **Step 2: Fresh reporter run.**

```bash
rm -f ~/code/tkmx-client/.reporting-state.json  # clean slate
REPORT_DEV_STATS=true REPORT_MACHINE_CONFIG=true \
  AGENTSVIEW_BIN=$(which agentsview) \
  SERVER_URL=http://localhost:3847 \
  USERNAME=wesm API_KEY=$YOUR_KEY \
  node reporter/report.js
```

- [ ] **Step 3: Visit `http://localhost:3847/user/wesm`** — confirm all seven new profile sections render with real data.

- [ ] **Step 4: Repeat the three-valued scenarios by toggling env vars.**

- [ ] **Step 5: Commit any final docs.**

```bash
git commit -am "reporter: end-to-end smoke verified" --allow-empty
```

---

## Post-implementation checklist

- [ ] `node --test test/` — all pass.
- [ ] Running with `REPORT_DEV_STATS=true` produces a non-null `body.session_stats` (confirmed via server logs).
- [ ] Toggling `REPORT_DEV_STATS` or `REPORT_SESSION_STATS` off → one-shot clear markers sent → subsequent runs stay quiet.
- [ ] Missing agentsview binary does not crash the reporter — it skips the field and continues.
- [ ] `.reporting-state.json` is gitignored and not leaked into the daemon's install location when the reporter is packaged.

## Open items to iterate on after initial merge

- **Stagger between agentsview sync and session-stats call.** Both are run by the daemon on a schedule; if the machine has thousands of sessions, the sync can take minutes. If session-stats picks up stale data, verify the command's own `--no-sync` or equivalent flag behavior. Consider calling `agentsview sync` explicitly before `session stats` in the reporter — mirrors the existing `queryAgent(..., noSync=false)` pattern for the first agent.
- **Retire `outcomes.js`** — once every machine has been on the new client long enough for tkmx-server's legacy fallback to become unnecessary, delete that collector in a follow-up PR. The server's outcome_stats will then come purely from `session_stats.outcome_stats`.
