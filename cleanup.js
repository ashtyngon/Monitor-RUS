// cleanup.js
require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;
const DRY_RUN = process.env.DRY_RUN === '1'; // set to "1" to preview only

const delay = (ms) => new Promise(res => setTimeout(res, ms));

const DROP_QUERY_PARAMS = new Set([
  'utm_source','utm_medium','utm_campaign','utm_term','utm_content','utm_id',
  'gclid','fbclid','mc_cid','mc_eid','igshid','ved','si','oc','ocid','ref','spm','yclid','utm_reader',
]);

// ---------- URL helpers ----------
function unwrapGoogleNews(raw) {
  try {
    const u = new URL(raw);
    if (!u.hostname.endsWith('news.google.com')) return raw;
    const inner = u.searchParams.get('url');
    return inner ? inner : raw;
  } catch {
    return raw;
  }
}

function normalizeUrl(raw) {
  if (!raw) return null;

  // Unwrap google news if possible
  let working = unwrapGoogleNews(raw.trim());

  let u;
  try { u = new URL(working); } catch { return null; }

  // Host: lowercase, drop www.
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');

  // Drop fragments
  u.hash = '';

  // Drop tracking params; sort stable
  const kept = [];
  u.searchParams.forEach((value, key) => {
    if (!DROP_QUERY_PARAMS.has(key.toLowerCase())) kept.push([key, value]);
  });
  kept.sort((a, b) => a[0].localeCompare(b[0]));
  u.search = '';
  for (const [k, v] of kept) u.searchParams.append(k, v);

  // Remove default ports
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) {
    u.port = '';
  }

  // Trim trailing slash (except root)
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.replace(/\/+$/, '');
  }

  const key = `${u.hostname}${u.pathname}${u.search || ''}`;
  return { key, host: u.hostname, isGoogleNews: u.hostname.endsWith('news.google.com') };
}

function googleNewsHasInnerUrl(raw) {
  try {
    const u = new URL(raw);
    return u.hostname.endsWith('news.google.com') && !!u.searchParams.get('url');
  } catch {
    return false;
  }
}

// ---------- Notion property access ----------
function normalizeWhitespace(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

// Prefer explicit URL property. Try common names first, then first url-type property.
function getPrimaryUrl(page) {
  const props = page.properties || {};
  for (const name of ['URL','Url','Link','link']) {
    const p = props[name];
    if (p?.type === 'url' && p.url) return p.url;
  }
  for (const k of Object.keys(props)) {
    const p = props[k];
    if (p?.type === 'url' && p.url) return p.url;
  }
  return null;
}

// Full title text (Notion titles are arrays)
function getHeadline(page) {
  const blocks = page.properties?.Headline?.title || [];
  const full = normalizeWhitespace(blocks.map(b => b.plain_text || '').join(' '));
  return full || null;
}

// ---------- Key builder (HYBRID LOGIC) ----------
function buildDedupeKey(page) {
  const rawUrl = getPrimaryUrl(page);

  // If URL is a google news link WITHOUT ?url=, ignore URL and use headline key
  if (rawUrl) {
    if (googleNewsHasInnerUrl(rawUrl)) {
      const norm = normalizeUrl(rawUrl);
      if (norm && norm.key && !norm.host.includes('notion.so') && !norm.host.includes('notion.site')) {
        console.log(`[key:url] ${norm.key}`);
        return `url:${norm.key}`;
      }
    } else {
      // No inner url param. If it’s a google-news /articles/… link, switch to headline key.
      try {
        const host = new URL(rawUrl).hostname.toLowerCase();
        if (host.endsWith('news.google.com')) {
          const h = getHeadlineKey(page, 12);
          if (h) {
            console.log(`[key:headline-google-news-no-url] "${h}"`);
            return `h:${h}`;
          }
        } else {
          const norm = normalizeUrl(rawUrl);
          if (norm && norm.key && !norm.host.includes('notion.so') && !norm.host.includes('notion.site')) {
            console.log(`[key:url] ${norm.key}`);
            return `url:${norm.key}`;
          }
        }
      } catch {
        // fallthrough to headline
      }
    }
  }

  // Fallback to headline-based key
  const h = getHeadlineKey(page, 12);
  if (h) {
    console.log(`[key:headline-fallback] "${h}"`);
    return `h:${h}`;
  }

  console.log(`[key:none] page ${page.id}`);
  return null;
}

function getHeadlineKey(page, words = 10) {
  const h = (getHeadline(page) || '').toLowerCase();
  if (!h) return null;
  return h.split(/\s+/).slice(0, words).join(' ');
}

// ---------- Fetch pages ----------
async function getRecentPages() {
  const pages = [];
  let hasMore = true;
  let nextCursor = undefined;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  console.log(`Fetching pages with Date on/after ${thirtyDaysAgo.toISOString()}...`);
  while (hasMore) {
    const resp = await notion.databases.query({
      database_id: databaseId,
      start_cursor: nextCursor,
      filter: {
        property: 'Date',
        date: { on_or_after: thirtyDaysAgo.toISOString() },
      },
      sorts: [{ property: 'Date', direction: 'descending' }],
    });

    pages.push(...resp.results);
    hasMore = resp.has_more;
    nextCursor = resp.next_cursor;
    console.log(`Fetched ${pages.length} pages so far...`);
    await delay(120);
  }

  // If nothing matched the Date filter (maybe Date is missing), retry without it (last 100 by created_time)
  if (pages.length === 0) {
    console.warn('No pages matched Date filter. Retrying without filter (last 100 by created_time)…');
    const resp = await notion.databases.query({
      database_id: databaseId,
      page_size: 100,
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
    });
    return resp.results;
  }

  return pages;
}

// ---------- Main ----------
async function findAndArchiveDuplicates() {
  const recentPages = await getRecentPages();
  console.log(`Total pages considered: ${recentPages.length}`);

  const buckets = new Map();
  let urlKeyCount = 0, headlineKeyCount = 0;

  for (const page of recentPages) {
    const key = buildDedupeKey(page);
    if (!key) continue;
    if (key.startsWith('url:')) urlKeyCount++; else headlineKeyCount++;

    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({
      id: page.id,
      created_time: page.created_time,
      headline: getHeadline(page),
      url: getPrimaryUrl(page),
    });
  }

  console.log(`Built ${buckets.size} keys. URL-based: ${urlKeyCount}; headline-based: ${headlineKeyCount}`);

  let duplicatesArchived = 0;
  for (const [key, items] of buckets.entries()) {
    if (items.length <= 1) continue;

    console.log(`\nGroup "${key}" — ${items.length} items`);
    // Keep earliest; archive the rest
    items.sort((a, b) => new Date(a.created_time) - new Date(b.created_time));

    // Show group contents
    for (const it of items) {
      console.log(`  ${it.created_time}  ${it.id}  ${it.headline ? `"${it.headline.slice(0, 80)}"` : ''}  ${it.url || ''}`);
    }

    const toArchive = items.slice(1);
    for (const p of toArchive) {
      try {
        if (DRY_RUN) {
          console.log(`  [dry-run] Would archive ${p.id}`);
        } else {
          await notion.pages.update({ page_id: p.id, archived: true });
          console.log(`  Archived ${p.id}`);
          duplicatesArchived++;
          await delay(280);
        }
      } catch (err) {
        console.error(`  Failed to archive ${p.id}: ${err.message}`);
      }
    }
  }

  console.log(`\nCleanup complete. Total duplicates archived: ${duplicatesArchived}${DRY_RUN ? ' (dry-run)' : ''}`);
}

findAndArchiveDuplicates().catch(err => {
  console.error('A fatal error occurred:', err);
  process.exit(1);
});
