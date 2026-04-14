const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

// Collect aggregate git outcome metrics from repos Claude touched.
// cwds: array of directory paths from workflow.js
// sinceDateStr: YYYYMMDD
// Returns aggregate stats — no repo names, no file names.
function collectOutcomeStats(cwds, sinceDateStr) {
  // Deduplicate to git root dirs
  const repos = new Set();
  for (const cwd of cwds) {
    try {
      if (!fs.existsSync(cwd)) continue;
      const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd, encoding: "utf-8", timeout: 5000,
      }).trim();
      repos.add(root);
    } catch { continue; }
  }

  if (repos.size === 0) return null;

  const sinceDate = `${sinceDateStr.slice(0, 4)}-${sinceDateStr.slice(4, 6)}-${sinceDateStr.slice(6, 8)}`;

  // Read the repo's configured author email. Returns null if user.email
  // isn't set for this repo (git falls back to global, which is fine —
  // we return whatever `git config user.email` resolves). Returns null on
  // any failure so the caller can skip repos with no identity.
  function repoAuthorEmail(repo) {
    try {
      const email = execFileSync("git", ["config", "user.email"], {
        cwd: repo, encoding: "utf-8", timeout: 5000,
      }).trim();
      return email || null;
    } catch { return null; }
  }

  let totalCommits = 0;
  let totalAdded = 0;
  let totalRemoved = 0;
  let totalFilesChanged = 0;

  const authoredRepos = new Set();

  for (const repo of repos) {
    const authorEmail = repoAuthorEmail(repo);
    if (!authorEmail) continue;
    try {
      const log = execFileSync(
        "git",
        ["log", `--since=${sinceDate}`, "--shortstat",
         `--author=${authorEmail}`, "--format=format:COMMIT"],
        { cwd: repo, encoding: "utf-8", timeout: 15000 },
      );

      let repoCommits = 0;
      for (const line of log.split("\n")) {
        if (line === "COMMIT") {
          repoCommits++;
          continue;
        }
        // " 3 files changed, 42 insertions(+), 10 deletions(-)"
        const filesMatch = line.match(/(\d+) files? changed/);
        const addMatch = line.match(/(\d+) insertions?\(\+\)/);
        const delMatch = line.match(/(\d+) deletions?\(-\)/);
        if (filesMatch) totalFilesChanged += parseInt(filesMatch[1]);
        if (addMatch) totalAdded += parseInt(addMatch[1]);
        if (delMatch) totalRemoved += parseInt(delMatch[1]);
      }
      if (repoCommits > 0) {
        totalCommits += repoCommits;
        authoredRepos.add(repo);
      }
    } catch { continue; }
  }

  // Optional: PR stats via gh CLI
  let prsOpened = 0;
  let prsMerged = 0;
  for (const repo of authoredRepos) {
    try {
      const raw = execFileSync(
        "gh",
        ["pr", "list", "--state=all", "--author=@me", `--search=created:>=${sinceDate}`,
         "--json", "state", "--limit", "200"],
        { cwd: repo, encoding: "utf-8", timeout: 15000 },
      );
      const prs = JSON.parse(raw);
      prsOpened += prs.length;
      prsMerged += prs.filter((p) => p.state === "MERGED").length;
    } catch { continue; }
  }

  return {
    repos_active: authoredRepos.size,
    commits: totalCommits,
    loc_added: totalAdded,
    loc_removed: totalRemoved,
    files_changed: totalFilesChanged,
    prs_opened: prsOpened,
    prs_merged: prsMerged,
  };
}

module.exports = { collectOutcomeStats };
