const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { parseExtraConfigs, aggregateClaudeResults } = require("../reporter/claude-collect");

describe("parseExtraConfigs", () => {
  it("splits, trims, and filters empty entries", () => {
    assert.deepEqual(
      parseExtraConfigs(" /a , /b,, /c "),
      ["/a", "/b", "/c"],
    );
  });

  it("returns [] for empty string", () => {
    assert.deepEqual(parseExtraConfigs(""), []);
  });

  it("returns [] for undefined", () => {
    assert.deepEqual(parseExtraConfigs(undefined), []);
  });

  it("handles a single entry with no commas", () => {
    assert.deepEqual(parseExtraConfigs("/only/one"), ["/only/one"]);
  });
});

describe("aggregateClaudeResults", () => {
  const day = (n) => ({ date: `2026-04-0${n}`, modelBreakdowns: [] });

  it("returns null err when any run produced data, even if others failed", () => {
    const r = aggregateClaudeResults([
      { daily: [day(1)], err: null },
      { daily: [], err: new Error("boom") },
    ]);
    assert.equal(r.err, null);
    assert.equal(r.daily.length, 1);
  });

  it("returns the first err when every run failed and no data came back", () => {
    const e1 = new Error("first");
    const e2 = new Error("second");
    const r = aggregateClaudeResults([
      { daily: [], err: e1 },
      { daily: [], err: e2 },
    ]);
    assert.equal(r.err, e1);
    assert.deepEqual(r.daily, []);
  });

  it("returns null err when runs succeeded with zero days (legit empty window)", () => {
    const r = aggregateClaudeResults([
      { daily: [], err: null },
      { daily: [], err: null },
    ]);
    assert.equal(r.err, null);
    assert.deepEqual(r.daily, []);
  });

  it("concatenates daily arrays across runs in order", () => {
    const r = aggregateClaudeResults([
      { daily: [day(1), day(2)], err: null },
      { daily: [day(3)], err: null },
    ]);
    assert.deepEqual(
      r.daily.map((d) => d.date),
      ["2026-04-01", "2026-04-02", "2026-04-03"],
    );
  });

  it("returns null err and empty daily for zero runs", () => {
    const r = aggregateClaudeResults([]);
    assert.equal(r.err, null);
    assert.deepEqual(r.daily, []);
  });
});
