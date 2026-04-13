const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { parseAgentsviewOutput, toIsoDate } = require("../reporter/agentsview");

describe("toIsoDate", () => {
  it("converts YYYYMMDD to YYYY-MM-DD", () => {
    assert.equal(toIsoDate("20260413"), "2026-04-13");
  });

  it("preserves single-digit months and days", () => {
    assert.equal(toIsoDate("20260101"), "2026-01-01");
  });
});

describe("parseAgentsviewOutput", () => {
  const sample = () => ({
    daily: [
      {
        date: "2026-04-10",
        modelBreakdowns: [
          {
            modelName: "claude-opus-4-6",
            inputTokens: 100,
            outputTokens: 200,
            cacheCreationTokens: 50,
            cacheReadTokens: 300,
            cost: 1.23,
          },
          {
            modelName: "claude-haiku-4-5",
            inputTokens: 10,
            outputTokens: 20,
            cacheCreationTokens: 5,
            cacheReadTokens: 30,
            cost: 0.05,
          },
        ],
      },
    ],
  });

  it("tags each breakdown with the given source", () => {
    const daily = parseAgentsviewOutput(sample(), "claude");
    for (const day of daily) {
      for (const m of day.modelBreakdowns) {
        assert.equal(m.source, "claude");
      }
    }
  });

  it("computes totalTokens as sum of all token-type fields", () => {
    const daily = parseAgentsviewOutput(sample(), "claude");
    assert.equal(daily[0].modelBreakdowns[0].totalTokens, 100 + 200 + 50 + 300);
    assert.equal(daily[0].modelBreakdowns[1].totalTokens, 10 + 20 + 5 + 30);
  });

  it("preserves the cost field untouched", () => {
    const daily = parseAgentsviewOutput(sample(), "claude");
    assert.equal(daily[0].modelBreakdowns[0].cost, 1.23);
    assert.equal(daily[0].modelBreakdowns[1].cost, 0.05);
  });

  it("returns [] for empty daily", () => {
    assert.deepEqual(parseAgentsviewOutput({ daily: [] }, "claude"), []);
  });

  it("returns [] when daily field is missing", () => {
    assert.deepEqual(parseAgentsviewOutput({}, "claude"), []);
  });

  it("treats missing token fields as 0 when computing totalTokens", () => {
    const parsed = {
      daily: [
        {
          date: "2026-04-10",
          modelBreakdowns: [
            { modelName: "x", inputTokens: 100, outputTokens: 50 },
          ],
        },
      ],
    };
    const daily = parseAgentsviewOutput(parsed, "codex");
    assert.equal(daily[0].modelBreakdowns[0].totalTokens, 150);
    assert.equal(daily[0].modelBreakdowns[0].source, "codex");
  });

  it("handles a day with no modelBreakdowns array", () => {
    const parsed = { daily: [{ date: "2026-04-10" }] };
    const daily = parseAgentsviewOutput(parsed, "claude");
    assert.equal(daily.length, 1);
    assert.equal(daily[0].date, "2026-04-10");
  });
});
