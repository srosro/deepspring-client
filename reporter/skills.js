const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_MANIFEST = path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json");

// Authoritative plugin list lives in installed_plugins.json — walking the
// cache directly would pick up temp_git_* clones and their repo contents.
function collectClaudeSkills(manifestPath = DEFAULT_MANIFEST) {
  if (!fs.existsSync(manifestPath)) return [];

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch {
    return [];
  }

  // Report one entry per installed plugin (e.g. "superpowers"), not one per
  // skill inside it — the plugin is the unit users recognize and share.
  // Sorted output keeps the machine-config hash stable across runs.
  const skills = new Set();
  const plugins = parsed.plugins || {};
  for (const pluginKey of Object.keys(plugins)) {
    // pluginKey looks like "superpowers@claude-plugins-official"
    skills.add(pluginKey.split("@")[0]);
  }
  return Array.from(skills).sort();
}

module.exports = { collectClaudeSkills };
