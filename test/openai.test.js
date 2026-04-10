const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { bucketsToDaily, collectOpenAIUsage } = require("../reporter/openai");

// Unix timestamp for 2026-04-05 00:00:00 local time
const APR_5_LOCAL = Math.floor(new Date(2026, 3, 5).getTime() / 1000);
const APR_6_LOCAL = Math.floor(new Date(2026, 3, 6).getTime() / 1000);

describe("bucketsToDaily", () => {
  it("converts a single bucket with one model to the daily breakdown shape", () => {
    const buckets = [
      {
        object: "bucket",
        start_time: APR_5_LOCAL,
        end_time: APR_6_LOCAL,
        results: [
          {
            object: "organization.usage.completions.result",
            input_tokens: 1000,
            input_cached_tokens: 200,
            output_tokens: 500,
            num_model_requests: 5,
            model: "gpt-4o",
          },
        ],
      },
    ];

    const result = bucketsToDaily(buckets);
    assert.equal(result.length, 1);
    assert.equal(result[0].date, "2026-04-05");
    assert.equal(result[0].modelBreakdowns.length, 1);
    const bd = result[0].modelBreakdowns[0];
    assert.equal(bd.modelName, "gpt-4o");
    // input_tokens includes cached; non-cached input is the difference
    assert.equal(bd.inputTokens, 800);
    assert.equal(bd.cacheReadTokens, 200);
    assert.equal(bd.cacheCreationTokens, 0);
    assert.equal(bd.outputTokens, 500);
    assert.equal(bd.source, "openai-api");
  });

  it("keeps per-model breakdowns separate within the same day", () => {
    const buckets = [
      {
        start_time: APR_5_LOCAL,
        results: [
          { input_tokens: 100, output_tokens: 50, model: "gpt-4o" },
          { input_tokens: 200, output_tokens: 100, model: "gpt-4o-mini" },
        ],
      },
    ];

    const result = bucketsToDaily(buckets);
    assert.equal(result.length, 1);
    assert.equal(result[0].modelBreakdowns.length, 2);
    const models = result[0].modelBreakdowns.map((b) => b.modelName).sort();
    assert.deepEqual(models, ["gpt-4o", "gpt-4o-mini"]);
  });

  it("groups multiple buckets by date and sorts ascending", () => {
    const buckets = [
      { start_time: APR_6_LOCAL, results: [{ input_tokens: 10, output_tokens: 5, model: "m" }] },
      { start_time: APR_5_LOCAL, results: [{ input_tokens: 20, output_tokens: 10, model: "m" }] },
    ];

    const result = bucketsToDaily(buckets);
    assert.deepEqual(result.map((d) => d.date), ["2026-04-05", "2026-04-06"]);
  });

  it("skips results with zero input and zero output tokens", () => {
    const buckets = [
      {
        start_time: APR_5_LOCAL,
        results: [
          { input_tokens: 0, output_tokens: 0, model: "gpt-4o" },
          { input_tokens: 100, output_tokens: 0, model: "gpt-4o" },
        ],
      },
    ];

    const result = bucketsToDaily(buckets);
    assert.equal(result.length, 1);
    assert.equal(result[0].modelBreakdowns.length, 1);
    assert.equal(result[0].modelBreakdowns[0].inputTokens, 100);
  });

  it("falls back to 'unknown' when the model field is missing", () => {
    const buckets = [
      { start_time: APR_5_LOCAL, results: [{ input_tokens: 10, output_tokens: 5 }] },
    ];

    const result = bucketsToDaily(buckets);
    assert.equal(result[0].modelBreakdowns[0].modelName, "unknown");
  });

  it("handles an empty bucket list", () => {
    assert.deepEqual(bucketsToDaily([]), []);
  });

  it("tolerates buckets with no results array", () => {
    const buckets = [{ start_time: APR_5_LOCAL }];
    assert.deepEqual(bucketsToDaily(buckets), []);
  });

  it("clamps negative input when cached exceeds total (defensive)", () => {
    // Shouldn't happen per spec, but if the API ever returns weird numbers
    // we want inputTokens floored at zero rather than going negative.
    const buckets = [
      {
        start_time: APR_5_LOCAL,
        results: [{ input_tokens: 100, input_cached_tokens: 150, output_tokens: 10, model: "m" }],
      },
    ];

    const result = bucketsToDaily(buckets);
    assert.equal(result[0].modelBreakdowns[0].inputTokens, 0);
    assert.equal(result[0].modelBreakdowns[0].cacheReadTokens, 150);
  });

  it("honors a custom source tag", () => {
    const buckets = [
      { start_time: APR_5_LOCAL, results: [{ input_tokens: 10, output_tokens: 5, model: "m" }] },
    ];
    const result = bucketsToDaily(buckets, "openai-test");
    assert.equal(result[0].modelBreakdowns[0].source, "openai-test");
  });
});

describe("collectOpenAIUsage", () => {
  it("returns an empty array when OPENAI_ADMIN_KEY is not set", async () => {
    const orig = process.env.OPENAI_ADMIN_KEY;
    delete process.env.OPENAI_ADMIN_KEY;
    try {
      const result = await collectOpenAIUsage("20260401");
      assert.deepEqual(result, []);
    } finally {
      if (orig !== undefined) process.env.OPENAI_ADMIN_KEY = orig;
    }
  });
});
