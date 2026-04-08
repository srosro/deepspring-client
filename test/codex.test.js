const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const Database = require("better-sqlite3");

const { collectCodexUsage, getCodexDbPath } = require("../reporter/codex");

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codex-test-"));
}

function createDb(dir, filename, schema) {
  const dbPath = path.join(dir, filename);
  const db = new Database(dbPath);
  db.exec(schema);
  return db;
}

const SCHEMA_NEW = `CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  model TEXT,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
)`;

const SCHEMA_OLD = `CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  model_provider TEXT,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
)`;

describe("getCodexDbPath", () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

  it("returns null when directory does not exist", () => {
    const orig = process.env.CODEX_HOME;
    process.env.CODEX_HOME = path.join(tmpDir, "nonexistent");
    assert.equal(getCodexDbPath(), null);
    process.env.CODEX_HOME = orig || "";
    if (!orig) delete process.env.CODEX_HOME;
  });

  it("returns null when no state_*.sqlite files exist", () => {
    const orig = process.env.CODEX_HOME;
    process.env.CODEX_HOME = tmpDir;
    assert.equal(getCodexDbPath(), null);
    process.env.CODEX_HOME = orig || "";
    if (!orig) delete process.env.CODEX_HOME;
  });

  it("picks the highest numbered state file", () => {
    fs.writeFileSync(path.join(tmpDir, "state_3.sqlite"), "");
    fs.writeFileSync(path.join(tmpDir, "state_5.sqlite"), "");
    fs.writeFileSync(path.join(tmpDir, "state_10.sqlite"), "");
    fs.writeFileSync(path.join(tmpDir, "other.sqlite"), "");

    const orig = process.env.CODEX_HOME;
    process.env.CODEX_HOME = tmpDir;
    assert.equal(getCodexDbPath(), path.join(tmpDir, "state_10.sqlite"));
    process.env.CODEX_HOME = orig || "";
    if (!orig) delete process.env.CODEX_HOME;
  });

  it("works with a single state file", () => {
    fs.writeFileSync(path.join(tmpDir, "state_5.sqlite"), "");

    const orig = process.env.CODEX_HOME;
    process.env.CODEX_HOME = tmpDir;
    assert.equal(getCodexDbPath(), path.join(tmpDir, "state_5.sqlite"));
    process.env.CODEX_HOME = orig || "";
    if (!orig) delete process.env.CODEX_HOME;
  });
});

describe("collectCodexUsage", () => {
  let tmpDir, origHome;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    origHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = tmpDir;
  });
  afterEach(() => {
    process.env.CODEX_HOME = origHome || "";
    if (!origHome) delete process.env.CODEX_HOME;
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns empty array when no codex db exists", () => {
    assert.deepEqual(collectCodexUsage("20260401"), []);
  });

  it("collects usage from new schema (model column)", () => {
    const db = createDb(tmpDir, "state_5.sqlite", SCHEMA_NEW);
    // April 5 2026 12:00 local
    const ts = Math.floor(new Date(2026, 3, 5, 12, 0, 0).getTime() / 1000);
    db.prepare("INSERT INTO threads (id, model, tokens_used, created_at) VALUES (?, ?, ?, ?)")
      .run("t1", "o4-mini", 50000, ts);
    db.prepare("INSERT INTO threads (id, model, tokens_used, created_at) VALUES (?, ?, ?, ?)")
      .run("t2", "o4-mini", 30000, ts + 3600);
    db.close();

    const result = collectCodexUsage("20260401");
    assert.equal(result.length, 1);
    assert.equal(result[0].date, "2026-04-05");
    assert.equal(result[0].modelBreakdowns.length, 1);
    assert.equal(result[0].modelBreakdowns[0].modelName, "o4-mini");
    assert.equal(result[0].modelBreakdowns[0].totalTokens, 80000);
    assert.equal(result[0].modelBreakdowns[0].source, "codex");
  });

  it("collects usage from old schema (model_provider column)", () => {
    const db = createDb(tmpDir, "state_5.sqlite", SCHEMA_OLD);
    const ts = Math.floor(new Date(2026, 3, 5, 12, 0, 0).getTime() / 1000);
    db.prepare("INSERT INTO threads (id, model_provider, tokens_used, created_at) VALUES (?, ?, ?, ?)")
      .run("t1", "openai", 100000, ts);
    db.close();

    const result = collectCodexUsage("20260401");
    assert.equal(result.length, 1);
    assert.equal(result[0].modelBreakdowns[0].modelName, "openai");
  });

  it("filters by since date", () => {
    const db = createDb(tmpDir, "state_5.sqlite", SCHEMA_NEW);
    const old = Math.floor(new Date(2026, 2, 1, 12, 0, 0).getTime() / 1000); // March 1
    const recent = Math.floor(new Date(2026, 3, 5, 12, 0, 0).getTime() / 1000); // April 5
    db.prepare("INSERT INTO threads (id, model, tokens_used, created_at) VALUES (?, ?, ?, ?)")
      .run("t1", "o3", 100000, old);
    db.prepare("INSERT INTO threads (id, model, tokens_used, created_at) VALUES (?, ?, ?, ?)")
      .run("t2", "o3", 200000, recent);
    db.close();

    const result = collectCodexUsage("20260401");
    assert.equal(result.length, 1);
    assert.equal(result[0].date, "2026-04-05");
    assert.equal(result[0].modelBreakdowns[0].totalTokens, 200000);
  });

  it("skips rows with zero tokens", () => {
    const db = createDb(tmpDir, "state_5.sqlite", SCHEMA_NEW);
    const ts = Math.floor(new Date(2026, 3, 5, 12, 0, 0).getTime() / 1000);
    db.prepare("INSERT INTO threads (id, model, tokens_used, created_at) VALUES (?, ?, ?, ?)")
      .run("t1", "o3", 0, ts);
    db.close();

    const result = collectCodexUsage("20260401");
    assert.deepEqual(result, []);
  });

  it("groups by date and model", () => {
    const db = createDb(tmpDir, "state_5.sqlite", SCHEMA_NEW);
    const day1 = Math.floor(new Date(2026, 3, 5, 10, 0, 0).getTime() / 1000);
    const day2 = Math.floor(new Date(2026, 3, 6, 10, 0, 0).getTime() / 1000);
    db.prepare("INSERT INTO threads (id, model, tokens_used, created_at) VALUES (?, ?, ?, ?)")
      .run("t1", "o3", 100000, day1);
    db.prepare("INSERT INTO threads (id, model, tokens_used, created_at) VALUES (?, ?, ?, ?)")
      .run("t2", "o4-mini", 50000, day1);
    db.prepare("INSERT INTO threads (id, model, tokens_used, created_at) VALUES (?, ?, ?, ?)")
      .run("t3", "o3", 200000, day2);
    db.close();

    const result = collectCodexUsage("20260401");
    assert.equal(result.length, 2);
    // Day 1 has two models
    const apr5 = result.find((d) => d.date === "2026-04-05");
    assert.equal(apr5.modelBreakdowns.length, 2);
    // Day 2 has one model
    const apr6 = result.find((d) => d.date === "2026-04-06");
    assert.equal(apr6.modelBreakdowns.length, 1);
  });

  it("sends zero cost (server-side estimation)", () => {
    const db = createDb(tmpDir, "state_5.sqlite", SCHEMA_NEW);
    const ts = Math.floor(new Date(2026, 3, 5, 12, 0, 0).getTime() / 1000);
    db.prepare("INSERT INTO threads (id, model, tokens_used, created_at) VALUES (?, ?, ?, ?)")
      .run("t1", "o4-mini", 1000000, ts);
    db.close();

    const result = collectCodexUsage("20260401");
    assert.equal(result[0].modelBreakdowns[0].cost, 0);
  });
});
