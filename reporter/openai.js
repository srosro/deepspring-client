const https = require("node:https");

// Fetch OpenAI platform usage (platform.openai.com/usage) for the given window.
// Requires OPENAI_ADMIN_KEY in env — an admin API key (sk-admin-...), not a
// regular project key. Create at platform.openai.com/settings/organization/admin-keys.
//
// Only the /completions endpoint is used — that covers chat completions and the
// Responses API, which is where essentially all token volume lives. Embeddings
// and moderations exist as separate endpoints but are a rounding error for
// most users; add them here if your org has meaningful volume there.

const USAGE_BASE = "https://api.openai.com/v1/organization/usage";
const REQUEST_TIMEOUT_MS = 30000;
const MAX_PAGES = 10;

function httpsGetJSON(url, apiKey) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`OpenAI usage API ${res.statusCode}: ${body.slice(0, 300)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(new Error(`Failed to parse OpenAI usage response: ${err.message}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error("OpenAI usage API request timed out"));
    });
    req.end();
  });
}

async function fetchAllBuckets(endpoint, apiKey, startTime) {
  const buckets = [];
  let page = null;
  // Safety cap: with bucket_width=1d&limit=31 a 30-day window fits in one page.
  // Grouped results don't increase page count, only result array size per bucket.
  for (let i = 0; i < MAX_PAGES; i++) {
    const url = new URL(`${USAGE_BASE}/${endpoint}`);
    url.searchParams.set("start_time", String(startTime));
    url.searchParams.set("bucket_width", "1d");
    url.searchParams.append("group_by", "model");
    url.searchParams.set("limit", "31");
    if (page) url.searchParams.set("page", page);

    const resp = await httpsGetJSON(url.toString(), apiKey);
    buckets.push(...(resp.data || []));
    if (!resp.has_more || !resp.next_page) break;
    page = resp.next_page;
  }
  return buckets;
}

// Convert OpenAI usage buckets to the modelBreakdowns-per-day shape the
// reporter merges and submits. Uses local timezone for the date string so
// days line up with ccusage/Codex dates.
function bucketsToDaily(buckets, source = "openai-api") {
  const byDate = {};
  for (const bucket of buckets) {
    const date = new Date(bucket.start_time * 1000);
    const dateStr =
      date.getFullYear() +
      "-" +
      String(date.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(date.getDate()).padStart(2, "0");

    for (const result of bucket.results || []) {
      const inputTokensTotal = result.input_tokens || 0;
      const outputTokens = result.output_tokens || 0;
      const cachedInput = result.input_cached_tokens || 0;
      if (inputTokensTotal === 0 && outputTokens === 0) continue;

      byDate[dateStr] = byDate[dateStr] || { date: dateStr, modelBreakdowns: [] };
      byDate[dateStr].modelBreakdowns.push({
        modelName: result.model || "unknown",
        // input_tokens in the OpenAI response already includes cached; split them
        // out so cache hits show up as cacheReadTokens (matches ccusage semantics).
        inputTokens: Math.max(0, inputTokensTotal - cachedInput),
        outputTokens,
        cacheCreationTokens: 0,
        cacheReadTokens: cachedInput,
        source,
      });
    }
  }
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

async function collectOpenAIUsage(sinceDateStr) {
  const apiKey = process.env.OPENAI_ADMIN_KEY;
  if (!apiKey) return [];

  // sinceDateStr is YYYYMMDD — start of that day, local time (match codex.js).
  const y = parseInt(sinceDateStr.slice(0, 4), 10);
  const m = parseInt(sinceDateStr.slice(4, 6), 10) - 1;
  const d = parseInt(sinceDateStr.slice(6, 8), 10);
  const startTime = Math.floor(new Date(y, m, d).getTime() / 1000);

  const buckets = await fetchAllBuckets("completions", apiKey, startTime);
  return bucketsToDaily(buckets);
}

module.exports = { collectOpenAIUsage, bucketsToDaily };
