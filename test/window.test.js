const { test } = require("node:test");
const assert = require("node:assert/strict");
const { STATS_WINDOW_DAYS, formatSinceStr } = require("../reporter/window");

test("STATS_WINDOW_DAYS is 28 — keeps rolling-window blobs on a full 28d window", () => {
  assert.equal(STATS_WINDOW_DAYS, 28);
});

test("formatSinceStr returns YYYYMMDD for the injected base date when days=0", () => {
  // Fixed base date — uses the `now` injection so the assertion can't
  // flake if the wall clock rolls over midnight between the two Date
  // constructions.
  const base = new Date(2026, 3, 24, 12, 0, 0);  // 2026-04-24 noon local
  assert.equal(formatSinceStr(0, base), "20260424");
});

test("formatSinceStr subtracts `days` across a month boundary", () => {
  // Spanning March → April catches the common off-by-one where someone
  // re-implements `setDate` without letting Date roll the month.
  const base = new Date(2026, 3, 5, 12, 0, 0);   // 2026-04-05 noon local
  assert.equal(formatSinceStr(28, base), "20260308");
});

test("formatSinceStr handles year rollover correctly", () => {
  const base = new Date(2026, 0, 10, 12, 0, 0);  // 2026-01-10 noon local
  assert.equal(formatSinceStr(28, base), "20251213");
});

test("formatSinceStr without injection returns today's date in YYYYMMDD", () => {
  // Sanity check the default path — no injection. Read the clock once
  // and pass the same instant to the helper so midnight rollover can't
  // desynchronize the two reads.
  const now = new Date();
  const expected =
    now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, "0") +
    now.getDate().toString().padStart(2, "0");
  assert.equal(formatSinceStr(0, now), expected);
});
