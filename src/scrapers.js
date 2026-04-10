const { chromium } = require("playwright");
const https = require("https");

function parseCompactNumber(rawValue) {
  if (!rawValue) {
    return null;
  }

  const normalized = String(rawValue).trim().replace(/,/g, "").toUpperCase();
  const match = normalized.match(/^([0-9]*\.?[0-9]+)\s*([KMB])?$/);

  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  const multiplier = {
    K: 1_000,
    M: 1_000_000,
    B: 1_000_000_000
  };

  return Math.round(value * (multiplier[match[2]] || 1));
}

function matchCount(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match) {
      const parsed = parseCompactNumber(match[1]);

      if (parsed !== null) {
        return parsed;
      }
    }
  }

  return null;
}

function extractFacebookStats(text) {
  return {
    followers: matchCount(text, [
      // English
      /([0-9][0-9.,]*\s*[KMB]?)\s+followers/i,
      /followers[^0-9]*([0-9][0-9.,]*\s*[KMB]?)/i,
      // Hindi (फ़ॉलोअर)
      /([0-9][0-9.,]*\s*[KMB]?)\s+फ़ॉलोअर/,
      /फ़ॉलोअर[^0-9]*([0-9][0-9.,]*\s*[KMB]?)/
    ]),
    likes: matchCount(text, [
      // English
      /([0-9][0-9.,]*\s*[KMB]?)\s+likes/i,
      /likes[^0-9]*([0-9][0-9.,]*\s*[KMB]?)/i,
      // Hindi (पसंद)
      /([0-9][0-9.,]*\s*[KMB]?)\s+पसंद/,
      /पसंद[^0-9]*([0-9][0-9.,]*\s*[KMB]?)/
    ])
  };
}

async function collectPageSignals(page) {
  const metaDescription =
    (await page.getAttribute('meta[name="description"]', "content").catch(() => null)) ||
    (await page.getAttribute('meta[property="og:description"]', "content").catch(() => null)) ||
    "";

  const title =
    (await page.getAttribute('meta[property="og:title"]', "content").catch(() => null)) ||
    (await page.title().catch(() => "")) ||
    "";

  const bodyText = (await page.locator("body").innerText().catch(() => "")) || "";

  // Exclude raw HTML — it contains href/attribute noise (e.g. /followers/) that
  // confuses regex patterns and produces false matches.
  return [metaDescription, title, bodyText]
    .filter(Boolean)
    .join("\n");
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error("HTTP timeout")); });
  });
}

// Fetch Instagram stats via the Graph API — reliable from datacenter IPs,
// no browser needed. Requires INSTAGRAM_ACCOUNT_ID and INSTAGRAM_PAGE_TOKEN env vars.
async function scrapeInstagramGraph(profile) {
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  const pageToken = process.env.INSTAGRAM_PAGE_TOKEN;

  if (!accountId || !pageToken) {
    throw new Error("Missing INSTAGRAM_ACCOUNT_ID or INSTAGRAM_PAGE_TOKEN environment variables.");
  }

  const url =
    `https://graph.facebook.com/v19.0/${accountId}` +
    `?fields=username,followers_count,follows_count,media_count` +
    `&access_token=${pageToken}`;

  const { status, body } = await httpGet(url);
  const data = JSON.parse(body);

  if (status !== 200 || data.error) {
    throw new Error(`Instagram Graph API error: ${data.error ? data.error.message : status}`);
  }

  return {
    ...profile,
    followers: data.followers_count || null,
    following: data.follows_count || null,
    posts: data.media_count || null,
    scrapedAtUtc: new Date().toISOString()
  };
}

// Fetch LinkedIn follower count via public HTTP (no auth needed for company pages).
// LinkedIn embeds the count in the og:description meta tag, e.g.
// "Crestmont Hotels | 1,234 followers on LinkedIn."
async function scrapeLinkedIn(profile) {
  const { status, body } = await httpGet(profile.url);

  if (status !== 200) {
    throw new Error(`LinkedIn returned HTTP ${status} for ${profile.url}`);
  }

  // Match og:description content attribute
  const ogDescMatch = body.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
    || body.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);

  const text = ogDescMatch ? ogDescMatch[1] : body;

  const followers = matchCount(text, [
    /([0-9][0-9.,]*\s*[KMB]?)\s+followers/i,
    /followers[^0-9]*([0-9][0-9.,]*\s*[KMB]?)/i
  ]);

  if (!followers) {
    const preview = text.slice(0, 300).replace(/\s+/g, " ");
    throw new Error(`Could not find LinkedIn follower count. Preview: ${preview}`);
  }

  return {
    ...profile,
    followers,
    scrapedAtUtc: new Date().toISOString()
  };
}

// Fetch YouTube subscriber count.
// Prefers the YouTube Data API v3 (requires YOUTUBE_API_KEY env var).
// Falls back to scraping the channel page HTML if the API key is absent.
async function scrapeYouTube(profile) {
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (apiKey) {
    return scrapeYouTubeViaApi(profile, apiKey);
  }

  return scrapeYouTubeViaHtml(profile);
}

async function scrapeYouTubeViaApi(profile, apiKey) {
  // Resolve the handle (@CrestmontHotels) to a channel id first, then fetch stats.
  const handle = profile.url.split("/@")[1];

  const searchUrl =
    `https://www.googleapis.com/youtube/v3/channels` +
    `?part=statistics` +
    `&forHandle=${encodeURIComponent(handle)}` +
    `&key=${apiKey}`;

  const { status, body } = await httpGet(searchUrl);
  const data = JSON.parse(body);

  if (status !== 200 || data.error) {
    throw new Error(`YouTube API error: ${data.error ? data.error.message : status}`);
  }

  const item = data.items && data.items[0];

  if (!item) {
    throw new Error(`YouTube API returned no channel for handle: ${handle}`);
  }

  const subscribers = item.statistics.subscriberCount
    ? parseInt(item.statistics.subscriberCount, 10)
    : null;

  if (!subscribers) {
    throw new Error(`YouTube channel has hidden subscriber count (handle: ${handle})`);
  }

  return {
    ...profile,
    followers: subscribers,
    scrapedAtUtc: new Date().toISOString()
  };
}

async function scrapeYouTubeViaHtml(profile) {
  const { status, body } = await httpGet(profile.url);

  if (status !== 200) {
    throw new Error(`YouTube returned HTTP ${status} for ${profile.url}`);
  }

  // YouTube embeds subscriber count in the page as:
  // "subscriberCountText":{"simpleText":"1.23K subscribers"}
  const match = body.match(/"subscriberCountText":\{"simpleText":"([^"]+)"/);
  const rawValue = match ? match[1] : null;

  // Strip the trailing " subscribers" word before parsing
  const cleaned = rawValue ? rawValue.replace(/\s*subscribers?/i, "").trim() : null;
  const followers = parseCompactNumber(cleaned);

  if (!followers) {
    const preview = (rawValue || body).slice(0, 300).replace(/\s+/g, " ");
    throw new Error(`Could not find YouTube subscriber count. Preview: ${preview}`);
  }

  return {
    ...profile,
    followers,
    scrapedAtUtc: new Date().toISOString()
  };
}

function ensureFollowers(stats, platform, textSnippet) {
  if (!stats.followers) {
    const preview = textSnippet.slice(0, 300).replace(/\s+/g, " ");
    throw new Error(`Could not find ${platform} follower count. Preview: ${preview}`);
  }

  return stats;
}

async function scrapeProfile(browser, profile) {
  // Instagram: use Graph API — headless browsers are blocked on datacenter IPs
  if (profile.platform === "instagram") {
    return scrapeInstagramGraph(profile);
  }

  // LinkedIn: plain HTTP fetch — headless browsers get blocked / CAPTCHA'd
  if (profile.platform === "linkedin") {
    return scrapeLinkedIn(profile);
  }

  // YouTube: API or HTML scrape — no browser needed
  if (profile.platform === "youtube") {
    return scrapeYouTube(profile);
  }

  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  });

  await page.goto(profile.url, {
    waitUntil: "domcontentloaded",
    timeout: 90_000
  });

  await page.waitForTimeout(5_000);

  const combinedText = await collectPageSignals(page);
  const stats = extractFacebookStats(combinedText);

  ensureFollowers(stats, profile.platform, combinedText);

  await page.close();

  return {
    ...profile,
    ...stats,
    scrapedAtUtc: new Date().toISOString()
  };
}

async function scrapeProfiles(profiles) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"]
  });

  try {
    const results = [];

    for (const profile of profiles) {
      const result = await scrapeProfile(browser, profile);
      results.push(result);
    }

    return results;
  } finally {
    await browser.close();
  }
}

module.exports = {
  scrapeProfiles,
  parseCompactNumber,
  extractFacebookStats
};
