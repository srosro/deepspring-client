const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { collectCodexUsage } = require("./codex");
const { mergeDailyUsage } = require("./merge");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const USERNAME = process.env.USERNAME;
const SERVER_URL = process.env.SERVER_URL || "https://www.deepspring.ai";
const TEAM = process.env.TEAM || "default";
const API_KEY = process.env.API_KEY;
const TOOLS = process.env.TOOLS || "";
const ABOUT = process.env.ABOUT || "";

// Resolve ccusage binary — launchd/systemd don't inherit the user's shell PATH
const CCUSAGE_CANDIDATES = [
  "/opt/homebrew/bin/ccusage",
  "/usr/local/bin/ccusage",
  `${process.env.HOME}/.npm-global/bin/ccusage`,
];
const CCUSAGE = CCUSAGE_CANDIDATES.find((p) => fs.existsSync(p)) || "ccusage";

if (!USERNAME || !API_KEY) {
  console.error("USERNAME and API_KEY must be set in .env");
  process.exit(1);
}

// 28 days ago in YYYYMMDD format
const since = new Date();
since.setDate(since.getDate() - 28);
const sinceStr =
  since.getFullYear().toString() +
  (since.getMonth() + 1).toString().padStart(2, "0") +
  since.getDate().toString().padStart(2, "0");

console.log(`[${new Date().toISOString()}] Collecting usage since ${sinceStr} for ${USERNAME} (team: ${TEAM})`);

// Collect Claude usage
let claudeDaily = [];
try {
  const raw = execFileSync(CCUSAGE, ["--json", "--offline", "--since", sinceStr], {
    encoding: "utf-8",
    timeout: 30000,
  });
  const parsed = JSON.parse(raw);
  claudeDaily = parsed.daily || [];
  // Tag each breakdown with source
  for (const day of claudeDaily) {
    for (const m of day.modelBreakdowns) {
      m.source = "claude";
    }
  }
  console.log(`  Claude: ${claudeDaily.length} days`);
} catch (err) {
  console.error("  ccusage failed (continuing with codex only):", err.message);
}

// Collect Codex usage
let codexDaily = [];
try {
  codexDaily = collectCodexUsage(sinceStr);
  console.log(`  Codex: ${codexDaily.length} days`);
} catch (err) {
  console.error("  Codex collection failed (continuing with claude only):", err.message);
}

const mergedDaily = mergeDailyUsage(claudeDaily, codexDaily);

if (mergedDaily.length === 0) {
  console.log("No usage data to report.");
  process.exit(0);
}

const payload = JSON.stringify({ username: USERNAME, team: TEAM, tools: TOOLS, about: ABOUT, data: mergedDaily });

const url = new URL("/api/usage", SERVER_URL);
const transport = url.protocol === "https:" ? https : http;

const req = transport.request(
  url,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
      "Authorization": `Bearer ${API_KEY}`,
    },
  },
  (res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => {
      console.log(`[${new Date().toISOString()}] Server responded ${res.statusCode}: ${body}`);
      if (res.statusCode !== 200) process.exit(1);
    });
  }
);

req.on("error", (err) => {
  console.error(`[${new Date().toISOString()}] Request failed:`, err.message);
  process.exit(1);
});

req.write(payload);
req.end();
