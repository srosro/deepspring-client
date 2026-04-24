const { test } = require("node:test");
const assert = require("node:assert/strict");
const { STATS_WINDOW_DAYS, formatSinceStr } = require("../reporter/window");

test("STATS_WINDOW_DAYS is 28 — keeps rolling-window blobs on a full 28d window", () => {
  assert.equal(STATS_WINDOW_DAYS, 28);
});

test("formatSinceStr returns YYYYMMDD for today when days=0", () => {
  const today = new Date();
  const expected =
    today.getFullYear().toString() +
    (today.getMonth() + 1).toString().padStart(2, "0") +
    today.getDate().toString().padStart(2, "0");
  assert.equal(formatSinceStr(0), expected);
});

test("formatSinceStr subtracts `days` correctly", () => {
  const out = formatSinceStr(28);
  assert.match(out, /^\d{8}$/);
  const y = parseInt(out.slice(0, 4), 10);
  const m = parseInt(out.slice(4, 6), 10) - 1;
  const d = parseInt(out.slice(6, 8), 10);
  const parsed = new Date(y, m, d);
  const now = new Date();
  // Allow ±1 day slack to absorb DST transitions and same-second edge cases.
  const diffDays = Math.round((now - parsed) / (1000 * 60 * 60 * 24));
  assert.ok(
    diffDays >= 27 && diffDays <= 29,
    `expected ~28 days ago, got ${diffDays} (out=${out})`,
  );
});
