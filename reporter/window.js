// STATS_WINDOW_DAYS is the fixed window for pre-aggregated rolling-window
// blobs (session_stats, cursor_stats). The server stores these wholesale,
// so windowing them to REPORT_DAYS would scrub prior history on short runs
// — e.g. a daily REPORT_DAYS=1 cron would drop 27 days of temporal patterns
// on every run. Pin to 28d. REPORT_DAYS continues to control the row-merged
// token-usage array (`data`), where short windows are safe because the
// server merges per-day rows rather than replacing the array.
const STATS_WINDOW_DAYS = 28;

// YYYYMMDD for `n` days ago in local time. Matches the date format
// agentsview / codex / openai collectors expect for day-aligned usage
// queries.
function formatSinceStr(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return (
    d.getFullYear().toString() +
    (d.getMonth() + 1).toString().padStart(2, "0") +
    d.getDate().toString().padStart(2, "0")
  );
}

module.exports = { STATS_WINDOW_DAYS, formatSinceStr };
