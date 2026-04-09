const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { collectCodexUsage } = require("./codex");
const { mergeDailyUsage } = require("./merge");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const USERNAME = process.env.USERNAME;
const SERVER_URL = process.env.SERVER_URL || "https://tokenmaxxing.odio.dev";
const TEAM = process.env.TEAM || "default";
const API_KEY = process.env.API_KEY;
const TOOLS = process.env.TOOLS || "";
const COMMUNITIES = process.env.COMMUNITIES || "";
const PROJECTS = process.env.PROJECTS || "";
const ABOUT = process.env.ABOUT || "";
const HN_USERNAME = process.env.HN_USERNAME || "";

// Stable machine identifier — auto-generated on first run
const ENV_PATH = path.join(__dirname, "..", ".env");
let CLIENT_ID = process.env.CLIENT_ID;
if (!CLIENT_ID) {
  CLIENT_ID = crypto.randomUUID();
  fs.appendFileSync(ENV_PATH, `CLIENT_ID=${CLIENT_ID}\n`);
  console.log(`Generated CLIENT_ID=${CLIENT_ID}`);
}

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

function collectMachineConfig() {
  if (process.env.REPORT_MACHINE_CONFIG !== "true") return null;

  const cfg = { hostname: os.hostname(), os: os.platform() + " " + os.release(), cpu: "", memory_gb: Math.round(os.totalmem() / 1e9) };
  const cpus = os.cpus();
  if (cpus.length > 0) cfg.cpu = cpus[0].model.trim() + " (" + cpus.length + " cores)";
  try { cfg.codex_version = execFileSync("codex", ["--version"], { encoding: "utf-8", timeout: 5000 }).trim(); } catch {}
  const pluginsDir = path.join(os.homedir(), ".claude", "plugins", "cache");
  if (fs.existsSync(pluginsDir)) {
    const skills = [];
    for (const org of fs.readdirSync(pluginsDir)) {
      const orgPath = path.join(pluginsDir, org);
      if (fs.statSync(orgPath).isDirectory()) {
        for (const plugin of fs.readdirSync(orgPath)) skills.push(plugin);
      }
    }
    if (skills.length > 0) cfg.claude_skills = skills;
  }
  // Only send if config changed since last report
  const cfgJson = JSON.stringify(cfg);
  const cfgHash = crypto.createHash("sha256").update(cfgJson).digest("hex").slice(0, 16);
  const hashFile = path.join(__dirname, "..", ".machine_config_hash");
  const lastHash = fs.existsSync(hashFile) ? fs.readFileSync(hashFile, "utf-8").trim() : "";
  if (cfgHash !== lastHash) {
    fs.writeFileSync(hashFile, cfgHash);
    console.log("  Machine config changed, will report");
    return cfg;
  }
  return null;
}

// Hey, you found the API call. Yes, you can post whatever you want — any tool,
// any numbers. This is a trust-based system. We don't have server-side validation
// that cross-checks your local usage logs because there's no way to do that without
// making the client invasive. We're running an experiment to see if a community of
// devs can self-report honestly and learn from each other's setups. Please don't
// pee in the punchbowl. If you want to add support for a new tool, we'd love a PR:
// https://github.com/srosro/tkmx-client
function postUsage(payload) {
  const url = new URL("/api/usage", SERVER_URL);
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
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
          if (res.statusCode !== 200) {
            reject(new Error(`Server returned ${res.statusCode}: ${body}`));
          } else {
            resolve();
          }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const REPORT_DAYS = parseInt(process.env.REPORT_DAYS) || 28;

  const since = new Date();
  since.setDate(since.getDate() - REPORT_DAYS);
  const sinceStr =
    since.getFullYear().toString() +
    (since.getMonth() + 1).toString().padStart(2, "0") +
    since.getDate().toString().padStart(2, "0");

  console.log(`[${new Date().toISOString()}] Collecting ${REPORT_DAYS}d usage since ${sinceStr} for ${USERNAME} (team: ${TEAM})`);

  // Collect Claude usage
  let claudeDaily = [];
  let claudeErr = null;
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
    claudeErr = err;
    console.error("  ccusage failed (continuing with codex only):", err.message);
  }

  // Collect Codex usage
  let codexDaily = [];
  let codexErr = null;
  try {
    codexDaily = collectCodexUsage(sinceStr);
    console.log(`  Codex: ${codexDaily.length} days`);
  } catch (err) {
    codexErr = err;
    console.error("  Codex collection failed (continuing with claude only):", err.message);
  }

  if (claudeErr && codexErr) {
    throw new Error("Both Claude and Codex collection failed");
  }

  const mergedDaily = mergeDailyUsage(claudeDaily, codexDaily);

  if (mergedDaily.length === 0) {
    console.log("No usage data to report.");
    return;
  }

  const body = {
    username: USERNAME,
    team: TEAM,
    tools: TOOLS,
    communities: COMMUNITIES,
    projects: PROJECTS,
    about: ABOUT,
    hn_username: HN_USERNAME,
    client_id: CLIENT_ID,
    report_days: REPORT_DAYS,
    data: mergedDaily,
  };
  const machineConfig = collectMachineConfig();
  if (machineConfig) body.machine_config = machineConfig;

  await postUsage(JSON.stringify(body));

  const profileUrl = `${SERVER_URL}/user/${USERNAME}`;
  console.log(`  Profile: ${profileUrl}`);
  if (!HN_USERNAME) {
    console.log(`  Set HN_USERNAME in .env to unlock leaderboard visibility`);
  } else {
    console.log(`  Verify your HN account at your profile page to appear on the leaderboard`);
  }
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] Fatal:`, err.message);
  process.exit(1);
});
