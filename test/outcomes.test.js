const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { collectOutcomeStats } = require("../reporter/outcomes");

describe("collectOutcomeStats", () => {
  let tmpRepo;

  before(() => {
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "tkmx-outcomes-"));
    execFileSync("git", ["init"], { cwd: tmpRepo });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpRepo });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpRepo });
    fs.writeFileSync(path.join(tmpRepo, "file.txt"), "hello\nworld\n");
    execFileSync("git", ["add", "file.txt"], { cwd: tmpRepo });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: tmpRepo });
    fs.writeFileSync(path.join(tmpRepo, "file.txt"), "hello\nworld\nfoo\nbar\n");
    execFileSync("git", ["add", "file.txt"], { cwd: tmpRepo });
    execFileSync("git", ["commit", "-m", "add lines"], { cwd: tmpRepo });
  });

  after(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  });

  it("returns null for empty cwds", () => {
    assert.equal(collectOutcomeStats([], "20260101"), null);
  });

  it("returns null for non-existent directories", () => {
    assert.equal(collectOutcomeStats(["/tmp/nonexistent-xyzzy-12345"], "20260101"), null);
  });

  it("counts commits, LOC, and files from a real repo", () => {
    const result = collectOutcomeStats([tmpRepo], "20260101");
    assert.ok(result);
    assert.equal(result.repos_active, 1);
    assert.equal(result.commits, 2);
    assert.ok(result.loc_added >= 4); // "hello\nworld\n" + "foo\nbar\n"
    assert.ok(result.files_changed >= 1);
  });

  it("never includes repo names in output", () => {
    const result = collectOutcomeStats([tmpRepo], "20260101");
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(tmpRepo));
    assert.ok(!serialized.includes("file.txt"));
  });

  it("deduplicates repos from multiple cwds in same repo", () => {
    const subdir = path.join(tmpRepo, "sub");
    fs.mkdirSync(subdir, { recursive: true });
    const result = collectOutcomeStats([tmpRepo, subdir], "20260101");
    assert.equal(result.repos_active, 1);
  });

  it("excludes commits authored by other users", () => {
    const mixedRepo = fs.mkdtempSync(path.join(os.tmpdir(), "tkmx-outcomes-mixed-"));
    try {
      execFileSync("git", ["init"], { cwd: mixedRepo });
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: mixedRepo });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: mixedRepo });
      fs.writeFileSync(path.join(mixedRepo, "a.txt"), "mine\n");
      execFileSync("git", ["add", "a.txt"], { cwd: mixedRepo });
      execFileSync("git", ["commit", "-m", "mine"], { cwd: mixedRepo });
      // Switch identity and author an unrelated commit.
      execFileSync("git", ["config", "user.email", "other@other.com"], { cwd: mixedRepo });
      execFileSync("git", ["config", "user.name", "Other"], { cwd: mixedRepo });
      fs.writeFileSync(path.join(mixedRepo, "b.txt"), "theirs\n");
      execFileSync("git", ["add", "b.txt"], { cwd: mixedRepo });
      execFileSync("git", ["commit", "-m", "theirs"], { cwd: mixedRepo });
      // Restore the target identity so repoAuthorEmail reads it.
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: mixedRepo });

      const result = collectOutcomeStats([mixedRepo], "20260101");
      assert.ok(result);
      assert.equal(result.commits, 1);
      assert.equal(result.repos_active, 1);
    } finally {
      fs.rmSync(mixedRepo, { recursive: true, force: true });
    }
  });

  it("does not substring-match other emails (notsam vs sam)", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tkmx-outcomes-substr-"));
    try {
      execFileSync("git", ["init"], { cwd: repo });
      execFileSync("git", ["config", "user.email", "sam@acme.com"], { cwd: repo });
      execFileSync("git", ["config", "user.name", "Sam"], { cwd: repo });
      fs.writeFileSync(path.join(repo, "a.txt"), "sam\n");
      execFileSync("git", ["add", "a.txt"], { cwd: repo });
      execFileSync("git", ["commit", "-m", "sam"], { cwd: repo });
      // A different author whose email is a superstring of sam@acme.com.
      execFileSync("git", ["config", "user.email", "notsam@acme.com"], { cwd: repo });
      execFileSync("git", ["config", "user.name", "NotSam"], { cwd: repo });
      fs.writeFileSync(path.join(repo, "b.txt"), "notsam\n");
      execFileSync("git", ["add", "b.txt"], { cwd: repo });
      execFileSync("git", ["commit", "-m", "notsam"], { cwd: repo });
      execFileSync("git", ["config", "user.email", "sam@acme.com"], { cwd: repo });

      const result = collectOutcomeStats([repo], "20260101");
      assert.equal(result.commits, 1);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("excludes repos where the author has no commits in the window (authoredRepos)", () => {
    const activeRepo = tmpRepo;
    const cloneRepo = fs.mkdtempSync(path.join(os.tmpdir(), "tkmx-outcomes-clone-"));
    try {
      execFileSync("git", ["init"], { cwd: cloneRepo });
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: cloneRepo });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: cloneRepo });
      // Commit authored by a different user — simulates a read-only clone
      // the current user has never touched.
      execFileSync("git", ["-c", "user.email=stranger@x.com", "-c", "user.name=Stranger",
        "commit", "--allow-empty", "-m", "upstream"], { cwd: cloneRepo });

      const result = collectOutcomeStats([activeRepo, cloneRepo], "20260101");
      assert.ok(result);
      assert.equal(result.repos_active, 1);
      assert.equal(result.commits, 2);
    } finally {
      fs.rmSync(cloneRepo, { recursive: true, force: true });
    }
  });

  it("dedupes commits and LOC across sibling clones with shared history", () => {
    // Clone `tmpRepo` into a sibling checkout that shares the same two commits
    // from the `before` hook. A naïve per-repo sum would double the LOC and
    // commit count; SHA-based dedup should collapse them.
    const sibling = fs.mkdtempSync(path.join(os.tmpdir(), "tkmx-outcomes-sibling-"));
    try {
      execFileSync("git", ["clone", tmpRepo, sibling], { stdio: "ignore" });
      // Cloned repo inherits history but not local user.email; set it so
      // repoAuthorEmail matches the original author.
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: sibling });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: sibling });

      const single = collectOutcomeStats([tmpRepo], "20260101");
      const both = collectOutcomeStats([tmpRepo, sibling], "20260101");

      assert.equal(both.commits, single.commits,
        "commits must not double when the same SHAs appear in a sibling");
      assert.equal(both.loc_added, single.loc_added,
        "loc_added must not double when the same SHAs appear in a sibling");
      assert.equal(both.loc_removed, single.loc_removed,
        "loc_removed must not double when the same SHAs appear in a sibling");
      assert.equal(both.files_changed, single.files_changed,
        "files_changed must not double when the same SHAs appear in a sibling");
      assert.equal(both.repos_active, 1,
        "a sibling that contributes no unique SHAs must not count as an active repo");
    } finally {
      fs.rmSync(sibling, { recursive: true, force: true });
    }
  });

});
