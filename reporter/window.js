// STATS_WINDOW_DAYS is the fixed window for pre-aggregated rolling-window
// blobs (session_stats, cursor_stats). tkmx-server stores these two fields
// wholesale — resolveMachineFields in tkmx-server/server/db.js replaces the
// prior JSON on every POST, not merges it — so windowing them to
// REPORT_DAYS here would clobber prior history. A daily REPORT_DAYS=1 cron
// would overwrite a machine's 28-day blob with a 1-day snapshot, dropping
// 27 days of totals, archetypes, temporal patterns, weekly distributions,
// agent_portfolio counts, and outcome stats every night. The profile would
// look like the user only worked today — until the next 28-day run.
//
// Pin these collectors to 28d regardless of REPORT_DAYS. REPORT_DAYS
// continues to control the row-merged token-usage array (body.data),
// where short windows are safe because the server merges per-day rows by
// date rather than replacing the array.
const STATS_WINDOW_DAYS = 28;

// YYYYMMDD for `n` days ago in local time. Matches the date format
// agentsview / codex / openai collectors expect for day-aligned usage
// queries. The `now` parameter exists for deterministic tests — callers
// should not pass it in production.
function formatSinceStr(days, now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return (
    d.getFullYear().toString() +
    (d.getMonth() + 1).toString().padStart(2, "0") +
    d.getDate().toString().padStart(2, "0")
  );
}

module.exports = { STATS_WINDOW_DAYS, formatSinceStr };
