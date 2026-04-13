const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { getCodexDbPath } = require("../reporter/codex");

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codex-test-"));
}

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
