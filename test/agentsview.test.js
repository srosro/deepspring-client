const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

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

describe("resolveAgentsview", () => {
  // Isolate each case from the host's real agentsview install and any
  // ambient AGENTSVIEW_BIN env var. Tests that need $PATH to find
  // something set PATH explicitly; the default empty PATH makes
  // `which agentsview` miss.
  function withIsolatedEnv(fn) {
    const origHome = process.env.HOME;
    const origPath = process.env.PATH;
    const origBin = process.env.AGENTSVIEW_BIN;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tkmx-resolve-"));
    process.env.HOME = tmp;
    process.env.PATH = "";
    delete process.env.AGENTSVIEW_BIN;
    try {
      return fn(tmp);
    } finally {
      process.env.HOME = origHome;
      process.env.PATH = origPath;
      if (origBin === undefined) delete process.env.AGENTSVIEW_BIN;
      else process.env.AGENTSVIEW_BIN = origBin;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  function writeExec(p, body = "#!/bin/sh\n") {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    fs.chmodSync(p, 0o755);
  }

  it("returns null when no candidate path exists", () => {
    withIsolatedEnv(() => {
      const { resolveAgentsview } = require("../reporter/agentsview");
      assert.equal(resolveAgentsview(), null);
    });
  });

  it("returns the first existing executable candidate", () => {
    withIsolatedEnv((tmp) => {
      const fake = path.join(tmp, ".local", "bin", "agentsview");
      writeExec(fake);
      const { resolveAgentsview } = require("../reporter/agentsview");
      assert.equal(resolveAgentsview(), fake);
    });
  });

  it("skips non-executable candidates", () => {
    withIsolatedEnv((tmp) => {
      const fake = path.join(tmp, ".local", "bin", "agentsview");
      fs.mkdirSync(path.dirname(fake), { recursive: true });
      fs.writeFileSync(fake, "#!/bin/sh\n");
      fs.chmodSync(fake, 0o644); // not executable
      const { resolveAgentsview } = require("../reporter/agentsview");
      assert.equal(resolveAgentsview(), null);
    });
  });

  it("skips candidates that are directories, not files", () => {
    withIsolatedEnv((tmp) => {
      fs.mkdirSync(path.join(tmp, ".local", "bin", "agentsview"), { recursive: true });
      const { resolveAgentsview } = require("../reporter/agentsview");
      assert.equal(resolveAgentsview(), null);
    });
  });

  it("respects AGENTSVIEW_BIN override", () => {
    withIsolatedEnv((tmp) => {
      const override = path.join(tmp, "nix", "store", "agentsview");
      writeExec(override);
      const candidate = path.join(tmp, ".local", "bin", "agentsview");
      writeExec(candidate);
      process.env.AGENTSVIEW_BIN = override;
      const { resolveAgentsview } = require("../reporter/agentsview");
      assert.equal(resolveAgentsview(), override);
    });
  });

  it("ignores AGENTSVIEW_BIN override when it points at nothing", () => {
    withIsolatedEnv((tmp) => {
      const candidate = path.join(tmp, ".local", "bin", "agentsview");
      writeExec(candidate);
      process.env.AGENTSVIEW_BIN = "/nonexistent/agentsview";
      const { resolveAgentsview } = require("../reporter/agentsview");
      assert.equal(resolveAgentsview(), candidate);
    });
  });

  it("falls back to PATH when no hard-coded candidate exists", () => {
    withIsolatedEnv((tmp) => {
      const pathDir = path.join(tmp, "custom", "bin");
      const fake = path.join(pathDir, "agentsview");
      writeExec(fake);
      process.env.PATH = `${pathDir}:/usr/bin:/bin`;
      const { resolveAgentsview } = require("../reporter/agentsview");
      assert.equal(resolveAgentsview(), fake);
    });
  });
});
