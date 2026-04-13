const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { collectCodexUsage, collectCodexStats } = require("./codex");
const { collectAgentsviewUsage } = require("./agentsview");
const { collectOpenAIUsage } = require("./openai");
const { mergeDailyUsage } = require("./merge");
const { parseExtraConfigs, aggregateClaudeResults, collectCcusage } = require("./claude-collect");
const { collectClaudeSkills } = require("./skills");
const { collectConfigStack } = require("./config-stack");
const { collectWorkflowStats } = require("./workflow");
const { collectOutcomeStats } = require("./outcomes");
const { collectCursorStats } = require("./cursor");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { version: CLIENT_VERSION } = require("../package.json");
const USERNAME = process.env.USERNAME;
const SERVER_URL = process.env.SERVER_URL || "https://tokenmaxxing.odio.dev";
const TEAM = process.env.TEAM || "default";
const API_KEY = process.env.API_KEY;
const TOOLS = process.env.TOOLS || "";
const COMMUNITIES = process.env.COMMUNITIES || "";
const PROJECTS = process.env.PROJECTS || "";
const ABOUT = process.env.ABOUT || "";
const HN_USERNAME = process.env.HN_USERNAME || "";
const DEMO_VIDEO_URL = process.env.DEMO_VIDEO_URL || "";
// Additional Claude config dirs to collect usage from (comma-separated). Each
// must be a directory containing a `projects/` subdirectory of JSONL session
// files — typically a synced snapshot of another machine's ~/.claude. Lets a
// single reporter aggregate usage across several machines without installing
// the client on each one.
const EXTRA_CLAUDE_CONFIGS = process.env.EXTRA_CLAUDE_CONFIGS || "";

const ENV_PATH = path.join(__dirname, "..", ".env");

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

// Read a per-host identifier from the OS so re-installs / parallel checkouts on
// the same machine collapse to one CLIENT_ID instead of triple-counting usage.
function readMachineId() {
  try {
    if (process.platform === "darwin") {
      const out = execFileSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { encoding: "utf8" });
      const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    } else if (process.platform === "linux") {
      for (const p of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
        if (fs.existsSync(p)) {
          const id = fs.readFileSync(p, "utf8").trim();
          if (id) return id;
        }
      }
    } else if (process.platform === "win32") {
      const out = execFileSync("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], { encoding: "utf8" });
      const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/);
      if (m) return m[1];
    }
  } catch (_) {}
  return null;
}

// Salted with username so the same host shared by two users yields two distinct
// IDs, and so the raw OS identifier never leaves the machine.
function deriveClientId(username) {
  const machineId = readMachineId();
  if (!machineId) return crypto.randomUUID();
  return crypto.createHash("sha256").update(machineId + "|" + username).digest("hex").slice(0, 32);
}

// Stable machine identifier — derived from OS, written to .env on first run.
// Existing CLIENT_ID values in .env are preserved untouched.
let CLIENT_ID = process.env.CLIENT_ID;
if (!CLIENT_ID) {
  CLIENT_ID = deriveClientId(USERNAME);
  fs.appendFileSync(ENV_PATH, `CLIENT_ID=${CLIENT_ID}\n`);
  console.log(`Generated CLIENT_ID=${CLIENT_ID}`);
}

function collectMachineConfig() {
  if (process.env.REPORT_MACHINE_CONFIG !== "true") return null;

  const cfg = { hostname: os.hostname(), os: os.platform() + " " + os.release(), cpu: "", memory_gb: Math.round(os.totalmem() / 1e9) };
  const cpus = os.cpus();
  if (cpus.length > 0) cfg.cpu = cpus[0].model.trim() + " (" + cpus.length + " cores)";
  try { cfg.codex_version = execFileSync("codex", ["--version"], { encoding: "utf-8", timeout: 5000 }).trim(); } catch {}
  const skills = collectClaudeSkills();
  if (skills.length > 0) cfg.claude_skills = skills;
  Object.assign(cfg, collectConfigStack());
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
            return;
          }
          let parsed = {};
          try { parsed = JSON.parse(body); } catch {}
          resolve(parsed);
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
  // ccusage scans every JSONL transcript under ~/.claude/projects. Heavy users
  // with many projects or large session logs can exceed a tight timeout;
  // override with CCUSAGE_TIMEOUT_MS if 3 minutes isn't enough.
  const CCUSAGE_TIMEOUT_MS = parseInt(process.env.CCUSAGE_TIMEOUT_MS) || 180000;

  const since = new Date();
  since.setDate(since.getDate() - REPORT_DAYS);
  const sinceStr =
    since.getFullYear().toString() +
    (since.getMonth() + 1).toString().padStart(2, "0") +
    since.getDate().toString().padStart(2, "0");

  console.log(`[${new Date().toISOString()}] Collecting ${REPORT_DAYS}d usage since ${sinceStr} for ${USERNAME} (team: ${TEAM})`);

  // Primary local collection: by default, ccusage walks ~/.claude transcripts
  // and the codex state sqlite is read directly. Set USE_AGENTSVIEW=true to
  // route the local machine through the `agentsview usage daily` command
  // instead — it maintains its own sqlite synced from ~/.claude and ~/.codex,
  // which is faster and less resource-intensive on large histories.
  // EXTRA_CLAUDE_CONFIGS still runs ccusage per remote dir either way, since
  // agentsview has no equivalent for switching Claude config dirs.
  const useAgentsview = process.env.USE_AGENTSVIEW === "true";

  let localClaudeResult;
  let codexDaily;
  if (useAgentsview) {
    const { claudeDaily: localClaude, codexDaily: av } = collectAgentsviewUsage(sinceStr);
    console.log(`  Claude (agentsview): ${localClaude.length} days`);
    console.log(`  Codex (agentsview): ${av.length} days`);
    localClaudeResult = { daily: localClaude, err: null };
    codexDaily = av;
  } else {
    localClaudeResult = collectCcusage(CCUSAGE, sinceStr, "local", {}, CCUSAGE_TIMEOUT_MS);
    codexDaily = collectCodexUsage(sinceStr);
    console.log(`  Codex: ${codexDaily.length} days`);
  }

  const claudeResults = [localClaudeResult];
  for (const configDir of parseExtraConfigs(EXTRA_CLAUDE_CONFIGS)) {
    const label = path.basename(configDir) || configDir;
    if (!fs.existsSync(path.join(configDir, "projects"))) {
      const msg = `missing projects/ subdir at ${configDir}`;
      console.error(`  Claude (${label}) skipped: ${msg}`);
      claudeResults.push({ daily: [], err: new Error(msg) });
      continue;
    }
    claudeResults.push(
      collectCcusage(CCUSAGE, sinceStr, label, {
        CLAUDE_CONFIG_DIR: configDir,
        // Multi-machine dirs can be large; give ccusage more heap headroom.
        NODE_OPTIONS: "--max-old-space-size=8192",
      }, CCUSAGE_TIMEOUT_MS),
    );
  }

  const { daily: claudeDaily, err: claudeErr } = aggregateClaudeResults(claudeResults);
  if (claudeErr) throw claudeErr;

  // Optional — requires OPENAI_ADMIN_KEY. Covers API-key-authenticated usage
  // from platform.openai.com/usage. If your Codex is API-key-authed, leave
  // OPENAI_ADMIN_KEY unset to avoid double-counting.
  const openaiDaily = await collectOpenAIUsage(sinceStr);
  if (openaiDaily.length > 0) {
    console.log(`  OpenAI platform: ${openaiDaily.length} days`);
  }

  const mergedDaily = mergeDailyUsage(claudeDaily, codexDaily, openaiDaily);

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
    demo_video_url: DEMO_VIDEO_URL,
    client_id: CLIENT_ID,
    client_version: CLIENT_VERSION,
    report_days: REPORT_DAYS,
    data: mergedDaily,
  };
  const machineConfig = collectMachineConfig();
  if (machineConfig) body.machine_config = machineConfig;

  // Dev stats — behavioral data gated behind REPORT_DEV_STATS=true
  if (process.env.REPORT_DEV_STATS === "true") {
    console.log("  Collecting dev stats...");

    const workflowResult = await collectWorkflowStats(sinceStr);
    if (workflowResult) {
      body.workflow_stats = workflowResult.workflowStats;
      console.log(`  Workflow: ${workflowResult.workflowStats.sessions} sessions, ${workflowResult.workflowStats.assistant_turns} turns`);

      const outcomeStats = collectOutcomeStats(workflowResult.cwds, sinceStr);
      if (outcomeStats) {
        body.outcome_stats = outcomeStats;
        console.log(`  Outcomes: ${outcomeStats.commits} commits across ${outcomeStats.repos_active} repos`);
      }
    }

    const cursorStats = collectCursorStats(sinceStr);
    if (cursorStats) {
      body.cursor_stats = cursorStats;
      console.log(`  Cursor: ${cursorStats.scored_commits || 0} scored commits`);
    }

    const codexStats = collectCodexStats(sinceStr);
    if (codexStats) {
      body.codex_stats = codexStats;
      console.log(`  Codex stats: ${codexStats.sessions} sessions, ${codexStats.avg_tokens_per_session} avg tokens/session`);
    }
  }

  const response = await postUsage(JSON.stringify(body));

  const profileUrl = `${SERVER_URL}/user/${USERNAME}`;
  console.log(`  Profile: ${profileUrl}`);
  if (!HN_USERNAME) {
    console.log(`  Set HN_USERNAME in .env to unlock leaderboard visibility`);
  } else {
    console.log(`  Verify your HN account at your profile page to appear on the leaderboard`);
  }

  if (response && response.client_update) {
    const bar = "=".repeat(72);
    console.log(`\n${bar}\n⚠️  CLIENT UPDATE AVAILABLE\n${bar}\n${response.client_update}\n${bar}`);
  }
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] Fatal:`, err.message);
  process.exit(1);
});
