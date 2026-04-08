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

function collectCodexUsage(sinceDateStr) {
  const dbPath = getCodexDbPath();
  if (!dbPath) return [];

  // sinceDateStr is YYYYMMDD, convert to unix timestamp at start of that day (local time)
  const y = parseInt(sinceDateStr.slice(0, 4));
  const m = parseInt(sinceDateStr.slice(4, 6)) - 1;
  const d = parseInt(sinceDateStr.slice(6, 8));
  const sinceTs = Math.floor(new Date(y, m, d).getTime() / 1000);

  const db = new Database(dbPath, { readonly: true });
  // Schema varies: newer versions have `model`, older have `model_provider`
  const cols = db.pragma("table_info(threads)").map((c) => c.name);
  const modelCol = cols.includes("model") ? "model" : "model_provider";
  const rows = db
    .prepare(
      `SELECT ${modelCol} AS model, tokens_used, created_at
       FROM threads
       WHERE created_at >= ? AND tokens_used > 0`
    )
    .all(sinceTs);
  db.close();

  // Group by date (local time) and model
  const byDateModel = {};
  for (const row of rows) {
    const date = new Date(row.created_at * 1000);
    const dateStr = date.getFullYear() + "-" +
      String(date.getMonth() + 1).padStart(2, "0") + "-" +
      String(date.getDate()).padStart(2, "0");
    const model = row.model || "unknown";
    const key = dateStr + "|" + model;

    byDateModel[key] = byDateModel[key] || { date: dateStr, model, tokens: 0 };
    byDateModel[key].tokens += row.tokens_used;
  }

  // Convert to modelBreakdowns format grouped by date
  const byDate = {};
  for (const entry of Object.values(byDateModel)) {
    byDate[entry.date] = byDate[entry.date] || { date: entry.date, modelBreakdowns: [] };

    byDate[entry.date].modelBreakdowns.push({
      modelName: entry.model,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: entry.tokens,
      cost: 0,
      source: "codex",
    });
  }

  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = { collectCodexUsage, getCodexDbPath };
