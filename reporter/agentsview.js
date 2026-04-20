const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

// Resolve agentsview binary — launchd/systemd don't inherit user shell PATH,
// so we can't rely on execvp's default search. Resolution order:
//   1. $AGENTSVIEW_BIN (explicit override for nix, asdf, custom installs)
//   2. Hard-coded install-location candidates (matches the quickstart)
//   3. $PATH via `which agentsview` (covers interactive runs)
// Lazy so tests can swap HOME per-case.
function agentsviewCandidates() {
  return [
    `${process.env.HOME}/.local/bin/agentsview`,
    "/opt/homebrew/bin/agentsview",
    "/usr/local/bin/agentsview",
  ];
}

function isExecutableFile(p) {
  try {
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch { return false; }
}

function resolveAgentsview() {
  const override = process.env.AGENTSVIEW_BIN;
  if (override && isExecutableFile(override)) return override;
  for (const p of agentsviewCandidates()) {
    if (isExecutableFile(p)) return p;
  }
  try {
    const viaPath = execFileSync("/usr/bin/env", ["which", "agentsview"], {
      encoding: "utf-8", timeout: 5000,
    }).trim();
    if (viaPath && isExecutableFile(viaPath)) return viaPath;
  } catch {}
  return null;
}

// Parses `agentsview --version` raw output like
//   "agentsview v0.23.0-2-g1b484fb (commit 1b484fb, built 2026-04-19T00:00:00Z)"
// into the bare git-describe core ("0.23.0" / "0.23.0-2-g1b484fb"). The
// server's MIN-version gate compares the leading X.Y.Z, so the wrapper
// prefix and "(commit …, built …)" tail are dropped to keep the wire
// value compact and directly displayable. Returns null if the binary is
// missing or `--version` fails.
function detectAgentsviewVersion(bin, timeoutMs = 5000) {
  if (!bin) return null;
  let raw;
  try {
    raw = execFileSync(bin, ["--version"], {
      encoding: "utf-8",
      timeout: timeoutMs,
    }).trim();
  } catch (err) {
    console.error(`  agentsview --version failed: ${err.message}`);
    return null;
  }
  const m = raw.match(/v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return m ? m[1] : null;
}

function toIsoDate(sinceStr) {
  return `${sinceStr.slice(0, 4)}-${sinceStr.slice(4, 6)}-${sinceStr.slice(6, 8)}`;
}

// agentsview breakdown rows carry per-token-type counts but no totalTokens
// field; merge.js sums it, so compute it here.
function parseAgentsviewOutput(parsed, source) {
  const daily = parsed.daily || [];
  for (const day of daily) {
    for (const m of day.modelBreakdowns || []) {
      m.source = source;
      m.totalTokens =
        (m.inputTokens || 0) +
        (m.outputTokens || 0) +
        (m.cacheCreationTokens || 0) +
        (m.cacheReadTokens || 0);
    }
  }
  return daily;
}

function queryAgent(bin, since, agent, noSync, timeoutMs, extraEnv) {
  const args = ["usage", "daily", "--json", "--breakdown", "--agent", agent, "--since", since];
  if (noSync) args.push("--no-sync");
  const execOpts = { encoding: "utf-8", timeout: timeoutMs };
  if (extraEnv) execOpts.env = { ...process.env, ...extraEnv };
  let raw;
  try {
    raw = execFileSync(bin, args, execOpts);
  } catch (err) {
    const stderr = (err.stderr && err.stderr.toString().trim()) || "";
    const detail = stderr ? `: ${stderr}` : `: ${err.message}`;
    throw new Error(`agentsview ${agent} query failed${detail}`);
  }
  return parseAgentsviewOutput(JSON.parse(raw), agent);
}

function collectAgentsviewUsage(bin, sinceStr, timeoutMs = 180000) {
  const since = toIsoDate(sinceStr);

  // One sync call covers every agent: agentsview's syncAllLocked
  // (internal/sync/engine.go) iterates parser.Registry in a single
  // pass, so triggering sync via the claude query also picks up
  // codex, gemini, copilot, etc. The codex follow-up passes
  // --no-sync to avoid a redundant second pass. If agentsview ever
  // changes to per-agent sync scoping, drop --no-sync here.
  const claudeDaily = queryAgent(bin, since, "claude", false, timeoutMs);
  const codexDaily = queryAgent(bin, since, "codex", true, timeoutMs);

  return { claudeDaily, codexDaily };
}

// Single-agent (Claude) collection against an isolated agentsview data
// dir + projects dir. Used for EXTRA_CLAUDE_CONFIGS entries where we
// want per-remote-dir incremental sync without contaminating the local
// machine's ~/.agentsview/sessions.db.
function collectAgentsviewClaudeOnly(bin, sinceStr, env, timeoutMs = 180000) {
  const since = toIsoDate(sinceStr);
  return queryAgent(bin, since, "claude", false, timeoutMs, env);
}

module.exports = {
  collectAgentsviewUsage,
  collectAgentsviewClaudeOnly,
  parseAgentsviewOutput,
  toIsoDate,
  resolveAgentsview,
  detectAgentsviewVersion,
};
