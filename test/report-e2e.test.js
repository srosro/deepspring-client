// End-to-end regression test for the rolling-window scrubbing fix:
// running reporter/report.js with REPORT_DAYS=1 must still invoke
// agentsview with `--since 28d` for session_stats (and the 28d date for
// cursor_stats) so the server's wholesale-replaced blobs don't lose 27
// days of history.
//
// Runs the actual report.js as a child process, stubs agentsview via
// AGENTSVIEW_BIN to a recording bash script, and stubs the server via an
// in-process http.Server. No real network, no real DB.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

// Run reporter/report.js asynchronously so the in-process stub HTTP
// server's request handler can fire — spawnSync would block the event
// loop for the entire child lifetime and the server would never respond.
function runReporter(env, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [REPORT_JS], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

const REPO = path.join(__dirname, "..");
const REPORT_JS = path.join(REPO, "reporter", "report.js");
const STATE_PATH = path.join(REPO, ".reporting-state.json");
const ENV_PATH = path.join(REPO, ".env");

// Preserve the user's .reporting-state.json and .env during this test —
// the reporter writes to both on a successful run.
let savedState = null;
let savedEnv = null;

before(() => {
  if (fs.existsSync(STATE_PATH)) {
    savedState = fs.readFileSync(STATE_PATH);
  }
  if (fs.existsSync(ENV_PATH)) {
    savedEnv = fs.readFileSync(ENV_PATH);
  }
});

after(() => {
  if (savedState !== null) fs.writeFileSync(STATE_PATH, savedState);
  else if (fs.existsSync(STATE_PATH)) fs.unlinkSync(STATE_PATH);
  if (savedEnv !== null) fs.writeFileSync(ENV_PATH, savedEnv);
});

test("REPORT_DAYS=1 still invokes agentsview with --since 28d for session_stats", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tkmx-e2e-"));
  const argvLog = path.join(tmp, "argv.log");
  const fakeBin = path.join(tmp, "fake-agentsview");

  // Fake agentsview: records every invocation's argv to a log file, then
  // emits minimal valid JSON for each subcommand the reporter uses.
  fs.writeFileSync(
    fakeBin,
    `#!/usr/bin/env bash
printf '%s\\t' "$@" >> "${argvLog}"
printf '\\n' >> "${argvLog}"
case "$1" in
  --version)
    echo "agentsview v0.25.0 (commit abcdef1, built 2026-04-24T00:00:00Z)"
    ;;
  usage)
    # claude / codex both route here. Emit one dated row so mergedDaily
    # is non-empty and the reporter doesn't short-circuit.
    echo '{"daily":[{"date":"2026-04-23","modelBreakdowns":[{"modelName":"claude-sonnet-4-6","inputTokens":100,"outputTokens":50,"cacheCreationTokens":0,"cacheReadTokens":0}]}]}'
    ;;
  stats)
    # Echo the requested --since window so the test can verify the
    # reporter passed the 28d value, not REPORT_DAYS=1.
    SINCE=""
    for ((i=1; i<=$#; i++)); do
      if [[ "\${!i}" == "--since" ]]; then
        j=$((i+1))
        SINCE="\${!j}"
      fi
    done
    printf '{"schema_version":1,"window":{"days_arg":"%s"},"totals":{"sessions_all":7},"generated_at":"2026-04-24T00:00:00Z"}\\n' "$SINCE"
    ;;
  *)
    echo "unexpected: $*" >&2
    exit 2
    ;;
esac
`,
  );
  fs.chmodSync(fakeBin, 0o755);

  // Stub server: capture the first POST body and respond 200.
  let captured = null;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (req.url === "/api/usage" && req.method === "POST") {
        captured = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const result = await runReporter({
      // Inherit PATH so /bin/bash resolves for the fake script's shebang.
      PATH: process.env.PATH,
      HOME: tmp,  // isolate cursor db lookup
      USERNAME: "e2euser",
      API_KEY: "e2ekey",
      CLIENT_ID: "e2e-client-id-fixed",  // avoid writing to .env
      SERVER_URL: `http://127.0.0.1:${port}`,
      AGENTSVIEW_BIN: fakeBin,
      REPORT_DAYS: "1",
      REPORT_DEV_STATS: "true",
      REPORT_SESSION_STATS: "true",
      // Override whatever is in the user's .env — dotenv doesn't
      // overwrite existing env vars but WILL fill in unset ones,
      // which would otherwise surface the developer's real
      // REPORT_MACHINE_CONFIG=true and trigger real codex/git
      // invocations from collectMachineConfig.
      REPORT_MACHINE_CONFIG: "false",
      EXTRA_CLAUDE_CONFIGS: "",
      OPENAI_ADMIN_KEY: "",
      TEAM: "e2e",
    });

    assert.equal(
      result.status,
      0,
      `reporter exited non-zero.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    assert.ok(captured, "server did not capture a POST body");

    // Core assertion: session_stats was collected from a 28d window, not 1d.
    const argvLines = fs.readFileSync(argvLog, "utf-8").trim().split("\n");
    const statsInvocations = argvLines.filter((l) => l.startsWith("stats\t"));
    assert.ok(
      statsInvocations.length >= 1,
      `expected at least one 'stats' invocation, got ${argvLines.join(" | ")}`,
    );
    for (const line of statsInvocations) {
      assert.match(
        line,
        /--since\t28d/,
        `stats invocation should use --since 28d, got: ${line}`,
      );
    }

    // The fake echoed the --since back into window.days_arg; confirm the
    // POSTed blob carries the 28d value that the reporter passed through.
    assert.equal(
      captured.session_stats?.window?.days_arg,
      "28d",
      "POSTed session_stats should reflect the 28d window that agentsview was asked for",
    );

    // Sanity: report_days on the envelope still reflects REPORT_DAYS=1,
    // so the row-merged data array keeps the short-window semantic.
    assert.equal(captured.report_days, 1);
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
