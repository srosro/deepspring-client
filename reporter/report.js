const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const {
  collectAgentsviewUsage,
  collectAgentsviewClaudeOnly,
  resolveAgentsview,
} = require("./agentsview");
const { collectOpenAIUsage } = require("./openai");
const { mergeDailyUsage } = require("./merge");
const { collectClaudeSkills } = require("./skills");
const { collectConfigStack } = require("./config-stack");
const { collectCursorStats } = require("./cursor");
const { collectSessionStats } = require("./session-stats");
const { loadState, saveState, computeTransitionMarkers } = require("./reporting-state");

const STATE_PATH = path.join(__dirname, "..", ".reporting-state.json");

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

function parseExtraConfigs(raw) {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Deterministic per-config-dir data directory so agentsview can
// maintain a separate incrementally-synced sqlite for each remote
// mirror without contaminating the local machine's
// ~/.agentsview/sessions.db. Keyed by sha256 of the absolute path so
// multiple tkmx-clients pointing at the same mirror share one db.
function agentsviewDataDirFor(absConfigDir) {
  const hash = crypto.createHash("sha256").update(absConfigDir).digest("hex").slice(0, 16);
  return path.join(os.homedir(), ".agentsview-tkmx", hash);
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

  const since = new Date();
  since.setDate(since.getDate() - REPORT_DAYS);
  const sinceStr =
    since.getFullYear().toString() +
    (since.getMonth() + 1).toString().padStart(2, "0") +
    since.getDate().toString().padStart(2, "0");

  console.log(`[${new Date().toISOString()}] Collecting ${REPORT_DAYS}d usage since ${sinceStr} for ${USERNAME} (team: ${TEAM})`);

  // Require agentsview — v1.3.0 dropped ccusage as a supported collector.
  // Users who want the old flow can pin to the v1.2.0 tag.
  const agentsviewBin = resolveAgentsview();
  if (!agentsviewBin) {
    console.error("");
    console.error("agentsview not found.");
    console.error("");
    console.error("tkmx-client v1.3.0 requires agentsview for local token usage collection.");
    console.error("");
    console.error("Install (macOS / Linux):");
    console.error("  curl -fsSL https://agentsview.io/install.sh | bash");
    console.error("");
    console.error("Windows:");
    console.error("  powershell -ExecutionPolicy ByPass -c \"irm https://agentsview.io/install.ps1 | iex\"");
    console.error("");
    console.error("Custom install location? Set AGENTSVIEW_BIN=/path/to/agentsview");
    console.error("More: https://agentsview.io/quickstart/");
    console.error("");
    console.error("Prefer the previous ccusage-based flow? Pin to v1.2.0:");
    console.error("  cd tkmx-client && git checkout v1.2.0 && npm install");
    console.error("");
    process.exit(1);
  }
  console.log(`  Using agentsview at ${agentsviewBin}`);

  // Local machine: agentsview's default data dir + default claude/codex dirs.
  const { claudeDaily: localClaudeDaily, codexDaily } = collectAgentsviewUsage(agentsviewBin, sinceStr);
  console.log(`  Claude (local): ${localClaudeDaily.length} days`);
  console.log(`  Codex (local): ${codexDaily.length} days`);

  // EXTRA_CLAUDE_CONFIGS: one agentsview invocation per remote dir, each
  // with its own AGENT_VIEWER_DATA_DIR so incremental sync stays partitioned.
  // CLAUDE_PROJECTS_DIR points at the .claude/projects subdir of each entry
  // (tkmx-client's EXTRA_CLAUDE_CONFIGS semantic is still ".claude" roots —
  // we append /projects internally to match agentsview's CLAUDE_PROJECTS_DIR
  // convention).
  let claudeDaily = [...localClaudeDaily];
  for (const entry of parseExtraConfigs(EXTRA_CLAUDE_CONFIGS)) {
    const absEntry = path.resolve(entry);
    const label = path.basename(absEntry) || absEntry;
    const projectsDir = path.join(absEntry, "projects");
    if (!fs.existsSync(projectsDir)) {
      console.error(`  Claude (${label}) skipped: missing projects/ subdir at ${absEntry}`);
      continue;
    }
    const dataDir = agentsviewDataDirFor(absEntry);
    let remoteDaily;
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      remoteDaily = collectAgentsviewClaudeOnly(agentsviewBin, sinceStr, {
        AGENT_VIEWER_DATA_DIR: dataDir,
        CLAUDE_PROJECTS_DIR: projectsDir,
      });
    } catch (err) {
      console.error(`  Claude (${label}) failed: ${err.message}`);
      continue;
    }
    console.log(`  Claude (${label}): ${remoteDaily.length} days`);
    claudeDaily = claudeDaily.concat(remoteDaily);
  }

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

  const priorState = loadState(STATE_PATH);
  const currentState = {
    dev_stats_on:     process.env.REPORT_DEV_STATS === "true",
    session_stats_on: process.env.REPORT_SESSION_STATS !== "false"
                      && process.env.REPORT_DEV_STATS === "true",
  };

  // Dev stats — behavioral data gated behind REPORT_DEV_STATS=true
  if (process.env.REPORT_DEV_STATS === "true") {
    console.log("  Collecting dev stats...");

    const cursorStats = collectCursorStats(sinceStr);
    if (cursorStats) {
      body.cursor_stats = cursorStats;
      console.log(`  Cursor: ${cursorStats.scored_commits || 0} scored commits`);
    }

    if (currentState.session_stats_on) {
      console.log("  Collecting session stats (agentsview)...");
      const ss = collectSessionStats({
        sinceDays: Number(REPORT_DAYS) || 28,
        ghToken:   process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
      });
      if (ss) {
        body.session_stats = ss;
        console.log(`  Session stats: ${ss.totals?.sessions_all ?? "?"} sessions, schema v${ss.schema_version}`);
      }
    }
  }

  // Apply any transition markers (one-shot clear signals for on→off flips).
  const markers = computeTransitionMarkers(priorState, currentState);
  if (markers.clear_dev_stats) body.clear_dev_stats = true;
  if ("session_stats" in markers) body.session_stats = null;

  const response = await postUsage(JSON.stringify(body));

  // Persist state only on successful POST — so a transition marker is
  // retried on the next run if the POST failed.
  if (response && response.ok !== false) {
    saveState(STATE_PATH, currentState);
  }

  const profileUrl = `${SERVER_URL}/user/${USERNAME}`;
  console.log(`  Profile: ${profileUrl}`);

  if (!TOOLS) console.log(`  Set TOOLS in .env — which AI tools you use daily (e.g. superpowers,paperclip)`);
  if (!PROJECTS) console.log(`  Set PROJECTS in .env — what you're spending tokens on (e.g. tkmx,plow.co)`);
  if (!COMMUNITIES) console.log(`  Set COMMUNITIES in .env — which dev communities you're part of`);
  if (!ABOUT) console.log(`  Set ABOUT in .env — a short description for your profile page`);
  if (!DEMO_VIDEO_URL) console.log(`  Set DEMO_VIDEO_URL in .env — a 3-min demo of your AI workflow`);

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
