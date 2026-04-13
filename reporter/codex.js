const path = require("node:path");
const fs = require("node:fs");
const Database = require("better-sqlite3");

// Cost estimation is now handled server-side

function getCodexDbPath() {
  const home = process.env.CODEX_HOME || path.join(process.env.HOME, ".codex");
  if (!fs.existsSync(home)) return null;
  const files = fs.readdirSync(home).filter((f) => /^state_\d+\.sqlite$/.test(f));
  if (files.length === 0) return null;
  files.sort((a, b) => {
    const numA = parseInt(a.match(/\d+/)[0]);
    const numB = parseInt(b.match(/\d+/)[0]);
    return numB - numA;
  });
  return path.join(home, files[0]);
}

function collectCodexStats(sinceDateStr) {
  const dbPath = getCodexDbPath();
  if (!dbPath) return null;

  const y = parseInt(sinceDateStr.slice(0, 4));
  const m = parseInt(sinceDateStr.slice(4, 6)) - 1;
  const d = parseInt(sinceDateStr.slice(6, 8));
  const sinceTs = Math.floor(new Date(y, m, d).getTime() / 1000);

  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare(`
    SELECT
      COUNT(*) as sessions,
      COALESCE(AVG(tokens_used), 0) as avg_tokens,
      COALESCE(AVG(updated_at - created_at), 0) as avg_duration_sec
    FROM threads
    WHERE created_at >= ? AND tokens_used > 0
  `).get(sinceTs);
  db.close();

  if (!row || row.sessions === 0) return null;

  return {
    sessions: row.sessions,
    avg_tokens_per_session: Math.round(row.avg_tokens),
    avg_session_minutes: Math.round(row.avg_duration_sec / 60),
  };
}

module.exports = { collectCodexStats, getCodexDbPath };
