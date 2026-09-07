import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openDatabase } from "../reporter/sqlite";

import { collectCursorStats } from "../reporter/cursor";

describe("collectCursorStats", () => {
  let tmpDir;
  let dbPath;
  let origHome;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tkmx-cursor-"));
    const cursorDir = path.join(tmpDir, ".cursor", "ai-tracking");
    fs.mkdirSync(cursorDir, { recursive: true });
    dbPath = path.join(cursorDir, "ai-code-tracking.db");

    const db = openDatabase(dbPath);
    db.exec(`
      CREATE TABLE scored_commits (
        commitHash TEXT NOT NULL,
        branchName TEXT NOT NULL,
        scoredAt INTEGER NOT NULL,
        linesAdded INTEGER,
        linesDeleted INTEGER,
        tabLinesAdded INTEGER,
        tabLinesDeleted INTEGER,
        composerLinesAdded INTEGER,
        composerLinesDeleted INTEGER,
        humanLinesAdded INTEGER,
        humanLinesDeleted INTEGER,
        blankLinesAdded INTEGER,
        blankLinesDeleted INTEGER,
        commitMessage TEXT,
        commitDate TEXT,
        v1AiPercentage TEXT,
        v2AiPercentage TEXT,
        PRIMARY KEY (commitHash, branchName)
      );
      CREATE TABLE conversation_summaries (
        conversationId TEXT PRIMARY KEY,
        title TEXT,
        tldr TEXT,
        overview TEXT,
        summaryBullets TEXT,
        model TEXT,
        mode TEXT,
        updatedAt INTEGER NOT NULL
      );
    `);

    // Insert test data — recent commits
    db.prepare(`INSERT INTO scored_commits
      (commitHash, branchName, scoredAt, linesAdded, linesDeleted,
       tabLinesAdded, tabLinesDeleted, composerLinesAdded, composerLinesDeleted,
       humanLinesAdded, humanLinesDeleted, blankLinesAdded, blankLinesDeleted,
       commitMessage, commitDate)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("abc123", "main", Date.now(), 100, 20, 40, 5, 30, 5, 30, 10, 0, 0, "test commit", "2026-04-10");

    db.prepare(`INSERT INTO conversation_summaries
      (conversationId, model, mode, updatedAt)
      VALUES (?, ?, ?, ?)
    `).run("conv1", "claude-3-5-sonnet", "composer", Date.now());

    db.close();

    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  after(() => {
    process.env.HOME = origHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns scored commit stats with AI attribution", () => {
    const result = collectCursorStats("20260101");
    assert.ok(result);
    assert.equal(result.scored_commits, 1);
    assert.equal(result.tab_lines_added, 40);
    assert.equal(result.composer_lines_added, 30);
    assert.equal(result.human_lines_added, 30);
    assert.equal(result.ai_authored_pct, 70); // (40+30)/(40+30+30) = 70%
  });

  it("returns conversation model/mode breakdown", () => {
    const result = collectCursorStats("20260101");
    assert.ok(result.conversations);
    assert.equal(result.conversations["claude-3-5-sonnet/composer"], 1);
  });

  it("returns an empty object (not null) when the DB is present but the window has no activity", () => {
    // Use a future date so nothing matches. Returning {} rather than null
    // is load-bearing: report.js's `if (cursorStats)` is truthy on {} and
    // therefore still sends cursor_stats in the POST, which lets the
    // server's wholesale-replace overwrite the prior (now-stale) blob.
    // If this returned null, the body would omit cursor_stats entirely
    // and old Cursor data would linger on the profile forever.
    const result = collectCursorStats("20270101");
    assert.deepEqual(result, {});
  });

  it("never includes commit messages or branch names", () => {
    const result = collectCursorStats("20260101");
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes("test commit"));
    assert.ok(!serialized.includes("main"));
    assert.ok(!serialized.includes("abc123"));
  });
});
