const { execFileSync } = require("node:child_process");

function parseExtraConfigs(raw) {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Decide the overall Claude error from N per-run results.
// Claude counts as failed only if every run returned zero days AND at least
// one run errored. A legitimate "no usage in window" outcome (all runs
// succeeded with empty daily arrays) is not an error.
function aggregateClaudeResults(results) {
  const daily = results.flatMap((r) => r.daily);
  const errs = results.map((r) => r.err).filter(Boolean);
  const err = daily.length === 0 && errs.length > 0 ? errs[0] : null;
  return { daily, err };
}

function collectCcusage(ccusagePath, sinceStr, label, env, timeoutMs) {
  try {
    const raw = execFileSync(
      ccusagePath,
      ["--json", "--offline", "--since", sinceStr],
      { encoding: "utf-8", timeout: timeoutMs, env: { ...process.env, ...env } },
    );
    const parsed = JSON.parse(raw);
    const daily = parsed.daily || [];
    for (const day of daily) {
      for (const m of day.modelBreakdowns) m.source = "claude";
    }
    console.log(`  Claude (${label}): ${daily.length} days`);
    return { daily, err: null };
  } catch (err) {
    console.error(`  Claude (${label}) failed:`, err.message);
    return { daily: [], err };
  }
}

module.exports = { parseExtraConfigs, aggregateClaudeResults, collectCcusage };
