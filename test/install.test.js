const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { stableNodePath } = require("../reporter/install");

describe("stableNodePath", () => {
  it("rewrites Apple Silicon brew cellar path to stable symlink", () => {
    const existsSync = (p) => p === "/opt/homebrew/bin/node";
    const out = stableNodePath(
      "/opt/homebrew/Cellar/node/25.8.1_1/bin/node",
      { existsSync }
    );
    assert.equal(out, "/opt/homebrew/bin/node");
  });

  it("rewrites Intel brew cellar path to stable symlink", () => {
    const existsSync = (p) => p === "/usr/local/bin/node";
    const out = stableNodePath(
      "/usr/local/Cellar/node/24.0.0/bin/node",
      { existsSync }
    );
    assert.equal(out, "/usr/local/bin/node");
  });

  it("keeps cellar path if the stable symlink is missing", () => {
    const existsSync = () => false;
    const input = "/opt/homebrew/Cellar/node/25.8.1_1/bin/node";
    assert.equal(stableNodePath(input, { existsSync }), input);
  });

  it("leaves nvm paths alone (no stable alias available)", () => {
    const existsSync = () => true;
    const input = "/Users/alice/.nvm/versions/node/v24.14.1/bin/node";
    assert.equal(stableNodePath(input, { existsSync }), input);
  });

  it("leaves already-stable brew path alone", () => {
    const existsSync = () => true;
    const input = "/opt/homebrew/bin/node";
    assert.equal(stableNodePath(input, { existsSync }), input);
  });

  it("leaves arbitrary non-brew paths alone", () => {
    const existsSync = () => true;
    const input = "/usr/bin/node";
    assert.equal(stableNodePath(input, { existsSync }), input);
  });
});
