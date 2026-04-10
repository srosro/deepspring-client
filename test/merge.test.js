const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { mergeDailyUsage } = require("../reporter/merge");

describe("mergeDailyUsage", () => {
  it("merges two sources with overlapping dates", () => {
    const claude = [
      { date: "2026-04-05", modelBreakdowns: [{ modelName: "opus", totalTokens: 100 }] },
      { date: "2026-04-06", modelBreakdowns: [{ modelName: "opus", totalTokens: 200 }] },
    ];
    const codex = [
      { date: "2026-04-05", modelBreakdowns: [{ modelName: "o3", totalTokens: 50 }] },
      { date: "2026-04-07", modelBreakdowns: [{ modelName: "o3", totalTokens: 300 }] },
    ];

    const result = mergeDailyUsage(claude, codex);
    assert.equal(result.length, 3);
    // April 5 has both sources merged
    assert.equal(result[0].date, "2026-04-05");
    assert.equal(result[0].modelBreakdowns.length, 2);
    // April 6 has only claude
    assert.equal(result[1].date, "2026-04-06");
    assert.equal(result[1].modelBreakdowns.length, 1);
    // April 7 has only codex
    assert.equal(result[2].date, "2026-04-07");
    assert.equal(result[2].modelBreakdowns.length, 1);
  });

  it("returns sorted by date", () => {
    const source = [
      { date: "2026-04-07", modelBreakdowns: [] },
      { date: "2026-04-05", modelBreakdowns: [] },
      { date: "2026-04-06", modelBreakdowns: [] },
    ];
    const result = mergeDailyUsage(source);
    assert.deepEqual(result.map((d) => d.date), ["2026-04-05", "2026-04-06", "2026-04-07"]);
  });

  it("returns empty array for empty inputs", () => {
    assert.deepEqual(mergeDailyUsage([], []), []);
  });

  it("handles a single source", () => {
    const source = [
      { date: "2026-04-05", modelBreakdowns: [{ modelName: "opus", totalTokens: 100 }] },
    ];
    const result = mergeDailyUsage(source);
    assert.equal(result.length, 1);
    assert.equal(result[0].modelBreakdowns[0].totalTokens, 100);
  });

  // The following tests cover the PR #5 EXTRA_CLAUDE_CONFIGS case: one reporter
  // aggregates ccusage output from multiple machines, each of which may have
  // used the same claude model on the same day. Without summation, the server's
  // INSERT OR REPLACE (keyed on user/date/model/client_id) would silently drop
  // all but one of the colliding rows.

  const row = (modelName, totals, source = "claude") => ({
    modelName,
    source,
    inputTokens: totals.in || 0,
    outputTokens: totals.out || 0,
    cacheCreationTokens: totals.cw || 0,
    cacheReadTokens: totals.cr || 0,
    totalTokens: totals.total || 0,
    cost: totals.cost,
  });

  it("sums tokens and cost when the same (date, model, source) appears in two sources", () => {
    const local = [{
      date: "2026-04-09",
      modelBreakdowns: [row("claude-opus-4-6", { in: 100, out: 200, cw: 10, cr: 50, total: 360, cost: 1.25 })],
    }];
    const remote = [{
      date: "2026-04-09",
      modelBreakdowns: [row("claude-opus-4-6", { in: 400, out: 800, cw: 40, cr: 150, total: 1390, cost: 4.75 })],
    }];

    const result = mergeDailyUsage(local, remote);
    assert.equal(result.length, 1);
    assert.equal(result[0].modelBreakdowns.length, 1);
    const merged = result[0].modelBreakdowns[0];
    assert.equal(merged.modelName, "claude-opus-4-6");
    assert.equal(merged.source, "claude");
    assert.equal(merged.inputTokens, 500);
    assert.equal(merged.outputTokens, 1000);
    assert.equal(merged.cacheCreationTokens, 50);
    assert.equal(merged.cacheReadTokens, 200);
    assert.equal(merged.totalTokens, 1750);
    assert.equal(merged.cost, 6);
  });

  it("keeps different models separate on the same day", () => {
    const local = [{
      date: "2026-04-09",
      modelBreakdowns: [row("claude-opus-4-6", { total: 100 })],
    }];
    const remote = [{
      date: "2026-04-09",
      modelBreakdowns: [row("claude-haiku-4-5", { total: 200 })],
    }];
    const result = mergeDailyUsage(local, remote);
    assert.equal(result[0].modelBreakdowns.length, 2);
    const names = result[0].modelBreakdowns.map((b) => b.modelName).sort();
    assert.deepEqual(names, ["claude-haiku-4-5", "claude-opus-4-6"]);
  });

  it("keeps same model but different source separate", () => {
    const claude = [{
      date: "2026-04-09",
      modelBreakdowns: [row("shared-model", { total: 100 }, "claude")],
    }];
    const codex = [{
      date: "2026-04-09",
      modelBreakdowns: [row("shared-model", { total: 200 }, "codex")],
    }];
    const result = mergeDailyUsage(claude, codex);
    assert.equal(result[0].modelBreakdowns.length, 2);
    const bySource = Object.fromEntries(
      result[0].modelBreakdowns.map((b) => [b.source, b.totalTokens]),
    );
    assert.deepEqual(bySource, { claude: 100, codex: 200 });
  });

  it("sums across three or more sources", () => {
    const mk = (n) => [{ date: "2026-04-09", modelBreakdowns: [row("opus", { total: n })] }];
    const result = mergeDailyUsage(mk(100), mk(200), mk(300));
    assert.equal(result[0].modelBreakdowns.length, 1);
    assert.equal(result[0].modelBreakdowns[0].totalTokens, 600);
  });

  it("does not mutate the input source arrays", () => {
    const original = row("opus", { in: 10, total: 10 });
    const local = [{ date: "2026-04-09", modelBreakdowns: [original] }];
    const remote = [{ date: "2026-04-09", modelBreakdowns: [row("opus", { in: 5, total: 5 })] }];
    mergeDailyUsage(local, remote);
    assert.equal(original.inputTokens, 10);
    assert.equal(original.totalTokens, 10);
  });
});
