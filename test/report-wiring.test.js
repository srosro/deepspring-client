const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// report.js is a program, not a module — it runs on require (exits on
// missing USERNAME/API_KEY and writes to .env on first run), so there's
// no ergonomic way to unit-test its call-site wiring. Extracting a
// testable body-builder would introduce a lot of surface churn for a
// narrow guarantee.
//
// These grep-style tests guard against the specific regression in the
// original scrubbing bug: reintroducing REPORT_DAYS coupling to the
// rolling-window blob fields (session_stats, cursor_stats), which the
// server stores wholesale and would therefore lose history on short
// REPORT_DAYS runs.

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "reporter", "report.js"),
  "utf-8",
);

test("collectSessionStats uses STATS_WINDOW_DAYS, not REPORT_DAYS", () => {
  assert.match(
    SRC,
    /collectSessionStats\(\s*\{\s*sinceDays:\s*STATS_WINDOW_DAYS\s*\}\s*\)/,
    "collectSessionStats should pass sinceDays: STATS_WINDOW_DAYS",
  );
  assert.doesNotMatch(
    SRC,
    /sinceDays:\s*(?:Number\()?REPORT_DAYS/,
    "session_stats must not be windowed by REPORT_DAYS",
  );
});

test("collectCursorStats uses statsSinceStr, not sinceStr", () => {
  assert.match(
    SRC,
    /collectCursorStats\(\s*statsSinceStr\s*\)/,
    "collectCursorStats should receive the 28d statsSinceStr",
  );
  assert.doesNotMatch(
    SRC,
    /collectCursorStats\(\s*sinceStr\s*\)/,
    "cursor_stats must not be windowed by REPORT_DAYS",
  );
});
