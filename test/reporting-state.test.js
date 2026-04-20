const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("loadState returns defaults when file absent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tkmx-state-"));
  const filePath = path.join(dir, "state.json");
  const { loadState } = require("../reporter/reporting-state");
  const state = loadState(filePath);
  assert.deepEqual(state, { dev_stats_on: false, session_stats_on: false });
});

test("saveState and loadState roundtrip", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tkmx-state-"));
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
