# Tokenmaxxing Client

Reports your Claude Code and Codex token usage to the [Tokenmaxxing Leaderboard](https://tokenmaxxing.odio.dev). Each user gets a shareable profile page at `tokenmaxxing.odio.dev/user/YOUR_NAME`.

## Quick Start

```bash
npm install -g ccusage            # Claude Code usage reader
git clone git@github.com:srosro/tkmx-client.git
cd tkmx-client && npm install
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
git clone git@github.com:srosro/tkmx-client.git
cd tkmx-client
npm install
```

### 3. Register your username

Pick a unique username and provide your email. First come, first served.

```
curl -s -X POST https://tokenmaxxing.odio.dev/api/register \
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
| `TOOLS` | No | What AI coding tools do you actually use daily? (see [Tools, Projects & Communities](#tools-projects--communities)) |
| `PROJECTS` | No | What are you spending tokens on? The projects you're actively building with AI. |
| `COMMUNITIES` | No | What developer communities are you part of? |
| `ABOUT` | No | The main content of your profile — describe your setup, link to tools you use, share blog posts/videos about your workflow. URLs are auto-linked. See [Profile Page](#profile-page) |
| `HN_USERNAME` | No | Your Hacker News username (e.g. `Sam_Odio`). Required to appear on the leaderboard — see [HN Verification](#appearing-on-the-leaderboard-hn-verification) |
| `REPORT_DAYS` | No | Days of history to report (default: `28`). See [Backfill & Optimization](#backfill--optimization) |
| `REPORT_MACHINE_CONFIG` | No | Set to `true` to share machine info (OS, CPU, memory, installed skills) on your profile. No prompts, code, or keys are ever sent. |

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

## Updating

```bash
cd tkmx-client
git pull
npm install
```

Your existing config (credentials, `CLIENT_ID`) is preserved — `git pull` never touches `.env`.

### What's new

If you're updating an existing install, refer to the config table above and add any new `.env` values you don't already have:

| Setting | What it does |
|---------|-------------|
| `REPORT_MACHINE_CONFIG=true` | Shares your machine setup (OS, CPU, memory, installed skills) on your [profile page](#profile-page). **No prompts, code, conversation history, or API keys are ever sent.** |
| `PROJECTS=tkmx,plow.co` | Projects you're building. Shown as badges on your profile and leaderboard. |
| `COMMUNITIES=bloomberg-ai-engineering,agentcribs-community` | Developer communities you're part of. Shown as badges on your profile and leaderboard. |
| `ABOUT="..."` | Bio, config details, and links shown on your profile. Share your setup — blog posts, tweets, or videos where you've discussed your workflow. URLs are auto-linked. |
| `REPORT_DAYS=1` | Only send the last day each cycle instead of 28. Recommended after your first sync. |
| `HN_USERNAME=Sam_Odio` | Your Hacker News username. Required for leaderboard visibility — see [HN Verification](#appearing-on-the-leaderboard-hn-verification). |

`CLIENT_ID` is auto-generated on first run and written to `.env` — you don't need to set it. If you already have one, it's kept as-is.

## Backfill & Optimization

By default the reporter sends 28 days of history. To backfill older data or optimize steady-state reporting:

**Backfill** — set `REPORT_DAYS=365` in `.env` and run once:

```bash
npm run report
```

**Optimize** — after your initial sync, change to `REPORT_DAYS=1` in `.env` so the background service only reports the last day each cycle instead of re-sending 28 days every 2 hours.

You can always do a manual full re-sync by temporarily setting `REPORT_DAYS=28` and running `npm run report`.

## Multiple Machines

The client supports reporting from multiple machines under the same username. Each machine gets its own `CLIENT_ID` (auto-generated on first run), and the server tracks data per-machine. Setup on each machine is identical — just use the same `USERNAME`, `API_KEY`, and `TEAM` in `.env`.

Your [profile page](https://tokenmaxxing.odio.dev) shows how many machines you're reporting from.

## Profile Page

Each user gets a shareable profile at `https://tokenmaxxing.odio.dev/user/YOUR_NAME` showing:

- Token usage stats (28-day and all-time)
- Claude vs Codex cost breakdown
- Model breakdown by tokens
- Daily usage chart (28 days)
- Tools, projects, and community badges
- Number of reporting machines
- Your bio from the `ABOUT` field

The `ABOUT` field is the main content of your profile. This is your chance to help other developers by sharing what tools you use and how you use them. Link to the tools, share blog posts, YouTube videos, or tweets about your workflow:

```
ABOUT="Building with https://github.com/nickarail/arsenal — here's my setup video: https://youtube.com/... — 3x founder, shipping AI-first products"
```

URLs are auto-linked on your profile page. The more detail you share, the more useful your profile is to the community.

## Appearing on the Leaderboard (HN Verification)

To prevent fake accounts, new users must verify a Hacker News account to appear on the leaderboard. Here's how:

1. Set `HN_USERNAME` in your `.env` (e.g. `HN_USERNAME=Sam_Odio`)
2. Run `npm run report` so the server knows your HN username
3. Add your tkmx profile URL to your [HN about section](https://news.ycombinator.com/user). For example, see [Sam_Odio's HN profile](https://news.ycombinator.com/user?id=Sam_Odio) — the about field includes `https://tkmx.odio.dev/user/samodio`
4. Visit your tkmx profile and click "Verify"

HN may cache your about section for a few minutes. If verification fails, wait a minute and try again.

You can still register, report usage, and view your profile without verification — you just won't appear on the public leaderboard.

## Tools, Projects & Communities

Everyone's tweeting about the latest hot AI tool, but most of it is vaporware. By listing what you actually use day-to-day, you help the developer community see what's real and what's hype. Your usage data — backed by actual token spend — shows what tools people are building with in production, not just what they tried once and posted about.

All three fields show as clickable badges on your profile and the leaderboard.

```
TOOLS=superpowers,arsenal
PROJECTS=tkmx,plow.co
COMMUNITIES=bloomberg-ai-engineering,agentcribs-community
```

- **TOOLS** — What AI coding tools do you actually use daily? Only list what you really use, not everything you've tried.
- **PROJECTS** — What are you spending tokens on? The projects you're actively building with AI. Shows up as "building:" on your profile.
- **COMMUNITIES** — What developer communities are you part of? Clickable filters on the leaderboard.

### Known Tools

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

Both are merged and POSTed to the Tokenmaxxing server with your API key. Each report replaces previous data for the same machine and date range, so re-syncs are safe and idempotent.

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
