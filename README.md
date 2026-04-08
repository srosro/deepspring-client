# Deepspring Client

Reports your Claude Code and Codex token usage to the [Deepspring](https://www.deepspring.ai) leaderboard. Each user gets a shareable profile page at `deepspring.ai/user/YOUR_NAME`.

## Quick Start

```bash
npm install -g ccusage            # Claude Code usage reader
git clone git@github.com:srosro/deepspring-client.git
cd deepspring-client && npm install
cp .env.example .env              # then edit .env (see below)
npm run report                    # test it
npm run install-service           # auto-report every 2 hours
```

## Setup

### 1. Install dependencies

[ccusage](https://github.com/syumarin/ccusage) reads your local Claude Code usage data. Codex CLI usage is auto-detected from `~/.codex/` — no extra setup needed.

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

Pick a unique username and provide your email. First come, first served.

```
curl -s -X POST https://www.deepspring.ai/api/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"YOUR_NAME", "email":"you@example.com"}'
```

Save the returned API key — it cannot be retrieved later.

> Email is required at registration but kept private. It is never displayed or returned by any API.

### 4. Configure `.env`

```
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `USERNAME` | Yes | Your registered username |
| `API_KEY` | Yes | The key returned by `/api/register` |
| `TEAM` | No | Your team name (default: `default`) |
| `TOOLS` | No | Comma-separated tools/projects you use daily (see [Tools](#tools)) |
| `ABOUT` | No | Bio/contact info shown on your [profile page](#profile-page) |
| `REPORT_DAYS` | No | Days of history to report (default: `28`). See [Backfill & Optimization](#backfill--optimization) |

### 5. First run

```
npm run report
```

```
[2026-04-08T12:30:40.544Z] Collecting 28d usage since 20260311 for your-name (team: your-team)
  Claude: 23 days
  Codex: 5 days
[2026-04-08T12:30:44.237Z] Server responded 200: {"ok":true,"rows":56}
```

A `CLIENT_ID` is auto-generated on first run and saved to `.env`. This identifies your machine so multiple machines can report for the same username without overwriting each other.

### 6. Install the background service

```
npm run install-service
```

Uses **launchd** on macOS, **systemd** on Linux. Starts immediately, survives reboots, runs every 2 hours.

Verify it's running:

```bash
# macOS
launchctl list | grep token-tracking

# Linux
systemctl --user status token-tracking-reporter.timer
```

## Backfill & Optimization

By default the reporter sends 28 days of history. To backfill older data or optimize steady-state reporting:

**Backfill** — do a one-time run with a large window:

```bash
REPORT_DAYS=365 npm run report
```

**Optimize** — after your initial sync, set `REPORT_DAYS=1` in `.env` so the background service only reports the last day each cycle instead of re-sending 28 days every 2 hours:

```
REPORT_DAYS=1
```

You can always do a manual full re-sync by running `REPORT_DAYS=28 npm run report`.

## Multiple Machines

The client supports reporting from multiple machines under the same username. Each machine gets its own `CLIENT_ID` (auto-generated on first run), and the server tracks data per-machine. Setup on each machine is identical — just use the same `USERNAME`, `API_KEY`, and `TEAM` in `.env`.

Your [profile page](https://www.deepspring.ai) shows how many machines you're reporting from.

## Profile Page

Each user gets a shareable profile at `https://www.deepspring.ai/user/YOUR_NAME` showing:

- Token usage stats (28-day and all-time)
- Claude vs Codex cost breakdown
- Model breakdown by tokens
- Daily usage chart (28 days)
- Tools/projects badges
- Number of reporting machines
- Your bio from the `ABOUT` field

The `ABOUT` field in `.env` is displayed on your profile. Use it for a short bio, links, or contact info:

```
ABOUT="Building with AI. Twitter: @handle — https://yoursite.com"
```

URLs are auto-linked on the profile page.

## Tools

The `TOOLS` field tags your profile with the AI coding skills and projects you use. These show as badges on the leaderboard and feed the "Most Popular Projects" ranking.

Only list tools you actually use regularly — not everything you've tried.

| Tool | Description |
|------|-------------|
| [superpowers](https://github.com/nickarail/superpowers) | Claude Code skills for TDD, planning, debugging |
| [arsenal](https://github.com/nickarail/arsenal) | Extended Claude Code skill set |
| [paperclip](https://github.com/paperclipai/paperclip) | AI coding agent framework |
| [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex) | Codex CLI enhancements |
| [cmux](https://cmux.com/) | AI coding multiplexer |

## Cost Estimation

Cost is calculated server-side using current API pricing:

- **Claude models** — estimated per token type (input, output, cache write, cache read) when ccusage doesn't provide cost. When ccusage reports accurate cost, that's used as-is.
- **Codex models** — estimated using blended rates since Codex only reports total tokens (no input/output split).

You don't need to worry about pricing — the server handles it.

## How It Works

The reporter collects token usage from two sources:

- **Claude Code** via [ccusage](https://github.com/syumarin/ccusage) (`ccusage --json --offline`)
- **Codex CLI** from `~/.codex/state_*.sqlite` (auto-detected, skipped if not present)

Both are merged and POSTed to the Deepspring server with your API key. Each report replaces previous data for the same machine and date range, so re-syncs are safe and idempotent.

## Logs

```bash
# macOS
cat ~/Library/Logs/token-tracking-reporter.log

# Linux
journalctl --user -u token-tracking-reporter
```

## Manual Report

```
npm run report
```
