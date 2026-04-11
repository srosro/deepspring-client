const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const os = require("node:os");

if (os.platform() === "darwin") {
  uninstallLaunchd();
} else if (os.platform() === "linux") {
  uninstallSystemd();
} else {
  console.error(`Unsupported platform: ${os.platform()}`);
  process.exit(1);
}

function uninstallLaunchd() {
  const label = "com.token-tracking.reporter";
  const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);

  if (fs.existsSync(plistPath)) {
    try {
      execSync(`launchctl unload "${plistPath}" 2>/dev/null`);
      console.log(`Unloaded ${label}`);
    } catch {}
    fs.unlinkSync(plistPath);
    console.log(`Removed ${plistPath}`);
  } else {
    console.log(`No plist at ${plistPath} — nothing to remove`);
  }
}

// NOTE: this systemd path is untested — author only verified the launchd
// branch on darwin. Mirrors install.js step-for-step, but please sanity-check
// on linux before relying on it.
function uninstallSystemd() {
  const userDir = path.join(os.homedir(), ".config", "systemd", "user");
  const servicePath = path.join(userDir, "token-tracking-reporter.service");
  const timerPath = path.join(userDir, "token-tracking-reporter.timer");

  try {
    execSync("systemctl --user disable --now token-tracking-reporter.timer 2>/dev/null");
    console.log("Disabled and stopped token-tracking-reporter.timer");
  } catch {}

  let removed = false;
  for (const p of [timerPath, servicePath]) {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      console.log(`Removed ${p}`);
      removed = true;
    }
  }
  if (!removed) {
    console.log("No systemd units found — nothing to remove");
    return;
  }

  try {
    execSync("systemctl --user daemon-reload");
  } catch {}
}
