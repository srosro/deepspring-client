const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

// Resolve agentsview binary — launchd/systemd don't inherit user shell PATH.
const AGENTSVIEW_CANDIDATES = [
  `${process.env.HOME}/.local/bin/agentsview`,
  "/opt/homebrew/bin/agentsview",
  "/usr/local/bin/agentsview",
];

function resolveAgentsview() {
  return AGENTSVIEW_CANDIDATES.find((p) => fs.existsSync(p)) || "agentsview";
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

function queryAgent(bin, since, agent, noSync, timeoutMs) {
  const args = ["usage", "daily", "--json", "--breakdown", "--agent", agent, "--since", since];
  if (noSync) args.push("--no-sync");
  const raw = execFileSync(bin, args, { encoding: "utf-8", timeout: timeoutMs });
  return parseAgentsviewOutput(JSON.parse(raw), agent);
}

function collectAgentsviewUsage(sinceStr, timeoutMs = 180000) {
  const bin = resolveAgentsview();
  const since = toIsoDate(sinceStr);

  // First call syncs on demand; second reuses the just-synced state.
  const claudeDaily = queryAgent(bin, since, "claude", false, timeoutMs);
  const codexDaily = queryAgent(bin, since, "codex", true, timeoutMs);

  return { claudeDaily, codexDaily };
}

module.exports = { collectAgentsviewUsage, parseAgentsviewOutput, toIsoDate, resolveAgentsview };
