const { chromium } = require("playwright");

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

function extractInstagramStats(text) {
  return {
    followers: matchCount(text, [
      /([0-9][0-9.,]*\s*[KMB]?)\s+Followers/i,
      /Followers[^0-9]*([0-9][0-9.,]*\s*[KMB]?)/i
    ]),
    following: matchCount(text, [
      /([0-9][0-9.,]*\s*[KMB]?)\s+Following/i,
      /Following[^0-9]*([0-9][0-9.,]*\s*[KMB]?)/i
    ]),
    posts: matchCount(text, [
      /([0-9][0-9.,]*\s*[KMB]?)\s+Posts/i,
      /Posts[^0-9]*([0-9][0-9.,]*\s*[KMB]?)/i
    ])
  };
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
  const html = (await page.content().catch(() => "")) || "";

  // Exclude raw HTML — it contains href/attribute noise (e.g. /followers/) that
  // confuses regex patterns and produces false matches.
  return [metaDescription, title, bodyText]
    .filter(Boolean)
    .join("\n");
}

function ensureFollowers(stats, platform, textSnippet) {
  if (!stats.followers) {
    const preview = textSnippet.slice(0, 300).replace(/\s+/g, " ");
    throw new Error(`Could not find ${platform} follower count. Preview: ${preview}`);
  }

  return stats;
}

async function scrapeProfile(browser, profile) {
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
  const stats =
    profile.platform === "instagram"
      ? extractInstagramStats(combinedText)
      : extractFacebookStats(combinedText);

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
  extractInstagramStats,
  extractFacebookStats
};
