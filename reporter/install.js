const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const os = require("node:os");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const REPORT_SCRIPT = path.join(PROJECT_ROOT, "reporter", "report.js");

// `process.execPath` points at the real on-disk node binary, which on Homebrew
// is a versioned Cellar path like `/opt/homebrew/Cellar/node/25.8.1_1/bin/node`.
// Baking that into a launchd plist is a ticking time bomb: the next
// `brew upgrade node` deletes that cellar dir and the service starts failing
// silently with dyld "Library not loaded" errors. Rewrite cellar paths to the
// stable `<prefix>/bin/node` symlink that brew keeps pointing at the current
// version. nvm has the same fragility but no equivalent stable symlink, so we
// warn instead.
function stableNodePath(execPath, { existsSync = fs.existsSync } = {}) {
  const brewMatch = execPath.match(/^(.*)\/Cellar\/node\/[^/]+\/bin\/node$/);
  if (brewMatch) {
    const stable = path.join(brewMatch[1], "bin", "node");
    if (existsSync(stable)) return stable;
  }
  return execPath;
}

function warnIfFragileNodePath(execPath) {
  if (execPath.includes("/.nvm/versions/node/")) {
    console.warn(
      `Warning: installing against nvm node at ${execPath}. ` +
      `The service will break on \`nvm install\`/\`nvm uninstall\` of this version — ` +
      `re-run \`npm run install-service\` after nvm changes, or install with Homebrew node for stability.`
    );
  }
}

const NODE_PATH = stableNodePath(process.execPath);

if (require.main === module) {
  warnIfFragileNodePath(NODE_PATH);
  if (os.platform() === "darwin") {
    installLaunchd();
  } else if (os.platform() === "linux") {
    installSystemd();
  } else {
    console.error(`Unsupported platform: ${os.platform()}`);
    process.exit(1);
  }
}

module.exports = { stableNodePath };

function installLaunchd() {
  const label = "com.token-tracking.reporter";
  const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
  const logPath = path.join(os.homedir(), "Library", "Logs", "token-tracking-reporter.log");

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_PATH}</string>
    <string>${REPORT_SCRIPT}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${path.dirname(NODE_PATH)}:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>${PROJECT_ROOT}</string>
  <key>StartInterval</key>
  <integer>7200</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>`;

  // Unload first if already loaded
  try {
    execSync(`launchctl unload "${plistPath}" 2>/dev/null`);
  } catch {}

  fs.writeFileSync(plistPath, plist);
  console.log(`Wrote ${plistPath}`);

  execSync(`launchctl load "${plistPath}"`);
  console.log(`Loaded ${label} — will run every 2 hours and once now`);
}

function installSystemd() {
  const userDir = path.join(os.homedir(), ".config", "systemd", "user");
  fs.mkdirSync(userDir, { recursive: true });

  const servicePath = path.join(userDir, "token-tracking-reporter.service");
  const timerPath = path.join(userDir, "token-tracking-reporter.timer");

  const service = `[Unit]
Description=Token Tracking Reporter

[Service]
Type=oneshot
ExecStart=${NODE_PATH} ${REPORT_SCRIPT}
WorkingDirectory=${PROJECT_ROOT}
Environment=PATH=${path.dirname(NODE_PATH)}:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
`;

  const timer = `[Unit]
Description=Run Token Tracking Reporter every 2 hours

[Timer]
OnBootSec=5min
OnUnitActiveSec=2h
Persistent=true

[Install]
WantedBy=timers.target
`;

  fs.writeFileSync(servicePath, service);
  console.log(`Wrote ${servicePath}`);

  fs.writeFileSync(timerPath, timer);
  console.log(`Wrote ${timerPath}`);

  execSync("systemctl --user daemon-reload");
  execSync("systemctl --user enable --now token-tracking-reporter.timer");
  console.log("Enabled and started token-tracking-reporter.timer");
}
