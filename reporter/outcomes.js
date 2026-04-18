const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

// execFileSync inherits stderr to the parent by default, so every
// expected-failure call inside a try/continue pattern below would
// leak git's "fatal: not a git repository" and gh's "no git remotes
// found" noise into the reporter output (and log file) even though
// we handle the throw correctly. Silencing stderr here is safe — any
// real failure still surfaces via the thrown exception.
const quietStdio = ["ignore", "pipe", "ignore"];

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
        cwd, encoding: "utf-8", timeout: 5000, stdio: quietStdio,
      }).trim();
      repos.add(root);
    } catch { continue; }
  }

  if (repos.size === 0) return null;

  const sinceDate = `${sinceDateStr.slice(0, 4)}-${sinceDateStr.slice(4, 6)}-${sinceDateStr.slice(6, 8)}`;

  // Read the repo's locally-configured author email. `--local` forces
  // git to read only .git/config, skipping the global/system fallback
  // chain — otherwise a user who changed their global user.email since
  // writing old commits would see those commits disappear from the
  // window. Falls back to the global email only when no local identity
  // is set, matching how the commits were actually authored. Returns
  // null if neither is set so the caller can skip the repo.
  function repoAuthorEmail(repo) {
    const read = (scope) => {
      try {
        return execFileSync("git", ["config", scope, "user.email"], {
          cwd: repo, encoding: "utf-8", timeout: 5000, stdio: quietStdio,
        }).trim() || null;
      } catch { return null; }
    };
    return read("--local") || read("--global");
  }

  let totalCommits = 0;
  let totalAdded = 0;
  let totalRemoved = 0;
  let totalFilesChanged = 0;

  const authoredRepos = new Set();
  // Sibling checkouts of the same repo share merged commits. Dedupe by
  // SHA across the whole call so each commit is counted at most once.
  const seenShas = new Set();

  for (const repo of repos) {
    const authorEmail = repoAuthorEmail(repo);
    if (!authorEmail) continue;
    try {
      // Anchor --author to the literal `<email>` substring of git's
      // "Name <email>" author field. Plain `--author=sam@acme.com`
      // is a POSIX ERE and would also match `notsam@acme.com`, plus
      // treat `+` in gmail-style aliases as a regex metachar. The
      // angle brackets aren't metachars and aren't part of any
      // legal email, so they anchor the match without escaping.
      const log = execFileSync(
        "git",
        ["log", `--since=${sinceDate}`, "--shortstat",
         `--author=<${authorEmail}>`, "--format=format:%H"],
        { cwd: repo, encoding: "utf-8", timeout: 15000, stdio: quietStdio },
      );

      let repoUniqueCommits = 0;
      // True while parsing stats that belong to a SHA we haven't counted yet.
      let countCurrent = false;
      for (const line of log.split("\n")) {
        // SHA lines are exactly 40 lowercase hex chars with no leading space.
        // Shortstat lines start with a space (" 3 files changed, ..."), so
        // they can't collide with this pattern.
        if (/^[0-9a-f]{40}$/.test(line)) {
          if (seenShas.has(line)) {
            countCurrent = false;
          } else {
            seenShas.add(line);
            repoUniqueCommits++;
            countCurrent = true;
          }
          continue;
        }
        if (!countCurrent) continue;
        const filesMatch = line.match(/(\d+) files? changed/);
        const addMatch = line.match(/(\d+) insertions?\(\+\)/);
        const delMatch = line.match(/(\d+) deletions?\(-\)/);
        if (filesMatch) totalFilesChanged += parseInt(filesMatch[1], 10);
        if (addMatch) totalAdded += parseInt(addMatch[1], 10);
        if (delMatch) totalRemoved += parseInt(delMatch[1], 10);
      }
      if (repoUniqueCommits > 0) {
        totalCommits += repoUniqueCommits;
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
        { cwd: repo, encoding: "utf-8", timeout: 15000, stdio: quietStdio },
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
