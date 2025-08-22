require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;

// --- simple delay to avoid rate limits
const delay = (ms) => new Promise(res => setTimeout(res, ms));

// --- Params considered tracking/junk; drop them
const DROP_QUERY_PARAMS = new Set([
  'utm_source','utm_medium','utm_campaign','utm_term','utm_content','utm_id',
  'gclid','fbclid','mc_cid','mc_eid','igshid','ved','si','oc','ocid','ref','spm','yclid','utm_reader',
]);

/**
 * Try to extract a URL-type property from a Notion page.
 * If none found, returns null.
 */
function getUrlPropertyValue(page) {
  const props = page.properties || {};
  for (const key of Object.keys(props)) {
    const p = props[key];
    if (p && p.type === 'url' && p.url) {
      return p.url;
    }
  }
  return null;
}

/**
 * Build a lightweight textual key from Headline + Source (fallback).
 */
function createHeadlineSourceKey(page, words = 5) {
  const headlineProp = page.properties?.Headline;
  const sourceProp = page.properties?.Source;

  if (
    headlineProp?.title?.length > 0 &&
    sourceProp?.rich_text?.length > 0
  ) {
    const headline = headlineProp.title[0].plain_text.trim().toLowerCase();
    const source = sourceProp.rich_text[0].plain_text.trim().toLowerCase();
    return `${source} | ${headline.split(/\s+/).slice(0, words).join(' ')}`;
  }
  return null;
}

/**
 * Normalize a URL:
 * - Unwrap news.google.com (use url= param if present)
 * - Lowercase host and drop "www."
 * - Remove tracking params and fragments
 * - Remove default ports and trailing slashes
 * - Sort remaining query params
 */
function normalizeUrl(raw) {
  if (!raw) return null;

  let working = raw.trim();

  // Some feeds may HTML-encode the URL param; decode once if needed
  try {
    // If it's a Google News redirect with url= param, unwrap it
    const u0 = new URL(working);
    if (u0.hostname.endsWith('news.google.com')) {
      const inner = u0.searchParams.get('url');
      if (inner) working = inner;
    }
  } catch (_) {
    // If raw isn't a valid URL yet, skip and try later
  }

  let u;
  try {
    u = new URL(working);
  } catch (e) {
    return null; // not a valid URL
  }

  // Lowercase host, drop leading www.
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');

  // Remove fragment
  u.hash = '';

  // Remove tracking params and sort any remaining
  const kept = [];
  u.searchParams.forEach((value, key) => {
    if (!DROP_QUERY_PARAMS.has(key.toLowerCase())) {
      kept.push([key, value]);
    }
  });
  kept.sort((a, b) => a[0].localeCompare(b[0]));
  u.search = '';
  for (const [key, value] of kept) {
    u.searchParams.append(key, value);
  }

  // Remove default ports
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) {
    u.port = '';
  }

  // Normalize path (remove trailing slash except for root)
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.replace(/\/+$/, '');
  }

  // Return canonical string WITHOUT protocol (to avoid http/https dupes)
  const query = u.search ? u.search : '';
  return `${u.hostname}${u.pathname}${query}`;
}

/**
 * Build a robust dedupe key for a page:
 * 1) Prefer normalized URL if present
 * 2) Fallback to (source + first N words of headline)
 */
function buildDedupeKey(page) {
  const url = getUrlPropertyValue(page);
  const normalized = normalizeUrl(url);
  if (normalized) return `url:${normalized}`;

  const fallback = createHeadlineSourceKey(page, 7);
  if (fallback) return `hs:${fallback}`;
  return null;
}

async function getRecentPages() {
  const pages = [];
  let hasMore = true;
  let nextCursor = undefined;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  console.log(`Fetching pages created after ${thirtyDaysAgo.toISOString()}...`);
  while (hasMore) {
    const response = await notion.databases.query({
      database_id: databaseId,
      start_cursor: nextCursor,
      filter: {
        property: 'Date',
        date: { on_or_after: thirtyDaysAgo.toISOString() },
      },
      sorts: [
        { property: 'Date', direction: 'descending' },
      ],
    });

    pages.push(...response.results);
    hasMore = response.has_more;
    nextCursor = response.next_cursor;
    console.log(`Fetched ${pages.length} pages...`);
    await delay(200); // be nice to the API
  }
  console.log(`Total recent pages fetched: ${pages.length}`);
  return pages;
}

async function findAndArchiveDuplicates() {
  const recentPages = await getRecentPages();

  // Group by dedupe key
  const buckets = new Map();
  for (const page of recentPages) {
    const key = buildDedupeKey(page);
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({
      id: page.id,
      created_time: page.created_time,
      // Keep the raw key parts for debugging
      _debug: {
        url: getUrlPropertyValue(page),
        hsKey: createHeadlineSourceKey(page, 7),
      },
    });
  }

  console.log(`Built ${buckets.size} unique keys in the last 30 days.`);

  let duplicatesArchived = 0;

  for (const [key, items] of buckets.entries()) {
    if (items.length <= 1) continue;

    console.log(`\nKey "${key}" has ${items.length} items`);
    items.sort((a, b) => new Date(a.created_time) - new Date(b.created_time));

    // Keep the earliest; archive the rest
    const toArchive = items.slice(1);

    for (const p of toArchive) {
      try {
        await notion.pages.update({
          page_id: p.id,
          archived: true,
        });
        duplicatesArchived++;
        console.log(`  Archived page ${p.id}`);
        await delay(350);
      } catch (err) {
        console.error(`  Failed to archive ${p.id}: ${err.message}`);
      }
    }
  }

  console.log(`\nCleanup complete. Total duplicates archived: ${duplicatesArchived}`);
}

findAndArchiveDuplicates().catch(err => {
  console.error('A fatal error occurred:', err);
  process.exit(1);
});
