# Deepspring Client

Reports your Claude Code and Codex token usage to the [Deepspring](https://www.deepspring.ai) leaderboard.

## Setup

### 1. Install ccusage

[ccusage](https://github.com/syumarin/ccusage) reads your local Claude Code usage data.

```
npm install -g ccusage
```

### 2. Clone and install

```
git clone git@github.com:srosro/deepspring-client.git
cd deepspring-client
npm install
```

### 3. Register your username

Pick a unique username. First come, first served — once registered, only you can submit data for that name.

```
curl -s -X POST https://www.deepspring.ai/api/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"YOUR_NAME"}'
```

This returns your API key:

```json
{"ok":true,"key":"abc123..."}
```

Save this key. It cannot be retrieved later.

### 4. Configure `.env`

Copy the example and fill in your values:

```
cp .env.example .env
```

```
USERNAME=your-name
TEAM=your-team
API_KEY=your-api-key-from-step-3
TOOLS=comma,separated,tools
```

| Variable | Required | Description |
|----------|----------|-------------|
| `USERNAME` | Yes | Your registered username |
| `API_KEY` | Yes | The key returned by `/api/register` |
| `TEAM` | No | Your team name (default: `default`) |
| `TOOLS` | No | Comma-separated tools you **actively use daily** (see below) |

#### Tools

The `TOOLS` field tags your profile with the AI coding skills, integrations, and projects you use. These show as badges on the leaderboard and feed the "Most Popular Projects" ranking.

**Only list tools you actually use on a regular basis.** This is not a list of everything you've tried — it's what you rely on day-to-day. If you installed something once and didn't stick with it, leave it out.

Some examples:

| Tool | Description |
|------|-------------|
| [superpowers](https://github.com/nickarail/superpowers) | Claude Code skills for TDD, planning, debugging |
| [arsenal](https://github.com/nickarail/arsenal) | Extended Claude Code skill set |
| [paperclip](https://github.com/paperclipai/paperclip) | AI coding agent framework |
| [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex) | Codex CLI enhancements |
| [cmux](https://cmux.com/) | AI coding multiplexer |

### 5. Test it

```
npm run report
```

You should see output like:

```
[2026-04-07T18:02:23.981Z] Collecting usage since 20260331 for your-name (team: your-team)
  Claude: 8 days
  Codex: 2 days
[2026-04-07T18:02:26.837Z] Server responded 200: {"ok":true,"rows":21}
```

### 6. Install the background service

Run this once — it installs a background service that reports automatically every 2 hours. No cron job needed.

```
npm run install-service
```

This uses **launchd** on macOS and **systemd** on Linux. It starts immediately and survives reboots.

You can verify it's running:

```bash
# macOS
launchctl list | grep token-tracking

# Linux
systemctl --user status token-tracking-reporter.timer
```

## Dashboard

View the leaderboard at **https://www.deepspring.ai**

## How it works

The reporter collects token usage from two sources:

- **Claude Code** via [ccusage](https://github.com/syumarin/ccusage) (`ccusage --json --offline`)
- **Codex CLI** from `~/.codex/state_5.sqlite` (auto-detected, skipped if not present)

Both are merged and POSTed to the Deepspring server with your API key. The background service runs this automatically every 2 hours.

## Logs

```bash
# macOS
cat ~/Library/Logs/token-tracking-reporter.log

# Linux
journalctl --user -u token-tracking-reporter
```

## Manual report

```
npm run report
```
