const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const USERNAME = process.env.USERNAME;
const SERVER_URL = process.env.SERVER_URL;

// Resolve ccusage binary — launchd/systemd don't inherit the user's shell PATH
const CCUSAGE_CANDIDATES = [
  "/opt/homebrew/bin/ccusage",
  "/usr/local/bin/ccusage",
  `${process.env.HOME}/.npm-global/bin/ccusage`,
];
const CCUSAGE = CCUSAGE_CANDIDATES.find((p) => fs.existsSync(p)) || "ccusage";

if (!USERNAME || !SERVER_URL) {
  console.error("USERNAME and SERVER_URL must be set in .env");
  process.exit(1);
}

// 7 days ago in YYYYMMDD format
const since = new Date();
since.setDate(since.getDate() - 7);
const sinceStr =
  since.getFullYear().toString() +
  (since.getMonth() + 1).toString().padStart(2, "0") +
  since.getDate().toString().padStart(2, "0");

console.log(`[${new Date().toISOString()}] Collecting usage since ${sinceStr} for ${USERNAME}`);

let raw;
try {
  raw = execFileSync(CCUSAGE, ["--json", "--offline", "--since", sinceStr], {
    encoding: "utf-8",
    timeout: 30000,
  });
} catch (err) {
  console.error("ccusage failed:", err.message);
  process.exit(1);
}

const parsed = JSON.parse(raw);
const payload = JSON.stringify({ username: USERNAME, data: parsed.daily });

const url = new URL("/api/usage", SERVER_URL);
const transport = url.protocol === "https:" ? https : http;

const req = transport.request(
  url,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
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
