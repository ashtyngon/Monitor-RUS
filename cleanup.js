// cleanup.js
require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;
const DRY_RUN = process.env.DRY_RUN === '1';

const delay = (ms) => new Promise(res => setTimeout(res, ms));

const DROP_QUERY_PARAMS = new Set([
  'utm_source','utm_medium','utm_campaign','utm_term','utm_content','utm_id',
  'gclid','fbclid','mc_cid','mc_eid','igshid','ved','si','oc','ocid','ref','spm','yclid','utm_reader',
]);

// ---------- helpers ----------
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
  let working = unwrapGoogleNews(raw.trim());

  let u;
  try { u = new URL(working); } catch { return null; }

  // Lowercase host, drop www
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  // Drop fragment
  u.hash = '';

  // Remove tracking params, sort rest for stability
  const kept = [];
  u.searchParams.forEach((v, k) => {
    if (!DROP_QUERY_PARAMS.has(k.toLowerCase())) kept.push([k, v]);
  });
  kept.sort((a,b) => a[0].localeCompare(b[0]));
  u.search = '';
  for (const [k,v] of kept) u.searchParams.append(k, v);

  // Default ports
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) u.port = '';

  // Trim trailing slash (except root)
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '');

  const key = `${u.hostname}${u.pathname}${u.search || ''}`;
  return { key, host: u.hostname, isGoogleNews: u.hostname.endsWith('news.google.com') };
}

function googleNewsHasInnerUrl(raw) {
  try {
    const u = new URL(raw);
    return u.hostname.endsWith('news.google.com') && !!u.searchParams.get('url');
  } catch { return false; }
}

function normalizeWhitespace(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

// URL property: prefer common names, else first url-type prop
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

// Full headline text
function getHeadline(page) {
  const blocks = page.properties?.Headline?.title || [];
  const full = normalizeWhitespace(blocks.map(b => b.plain_text || '').join(' '));
  return full || null;
}

// Headline key: first N words, lowercase
function headlineKey(page, words = 12) {
  const h = (getHeadline(page) || '').toLowerCase();
  if (!h) return null;
  return h.split(/\s+/).slice(0, words).join(' ');
}

// Build BOTH keys; may return { urlKey, hKey }
function buildKeys(page) {
  const rawUrl = getPrimaryUrl(page);
  let urlKey = null;
  if (rawUrl) {
    // If google news has ?url= — unwrap; else we still normalize its own /articles/... form
    const norm = normalizeUrl(rawUrl);
    if (norm && norm.key && !norm.host.includes('notion.so') && !norm.host.includes('notion.site')) {
      urlKey = `url:${norm.key}`;
    }
    // If it’s a google news link with NO ?url=, we’ll rely more on headline too
    if (rawUrl && new URL(rawUrl).hostname.endsWith('news.google.com') && !googleNewsHasInnerUrl(rawUrl)) {
      // fall through; hKey will be crucial for grouping
    }
  }
  const h = headlineKey(page, 12);
  const hKey = h ? `h:${h}` : null;
  return { urlKey, hKey };
}

// ---------- fetch ----------
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
      filter: { property: 'Date', date: { on_or_after: thirtyDaysAgo.toISOString() } },
      sorts: [{ property: 'Date', direction: 'descending' }],
    });
    pages.push(...resp.results);
    hasMore = resp.has_more;
    nextCursor = resp.next_cursor;
    console.log(`Fetched ${pages.length} pages so far...`);
    await delay(120);
  }

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

// ---------- main (URL↔Headline alias merge) ----------
async function findAndArchiveDuplicates() {
  const recentPages = await getRecentPages();
  console.log(`Total pages considered: ${recentPages.length}`);

  // buckets: bucketId -> items[]
  // alias: headline key -> bucketId (so hKey can point to a URL bucket, or vice versa)
  const buckets = new Map();
  const alias = new Map();

  function chooseBucket(urlKey, hKey) {
    // If headline already mapped to a bucket, use it
    if (hKey && alias.has(hKey)) return alias.get(hKey);
    // Else if we have a URL key bucket, use/create it and map headline to it
    if (urlKey) {
      if (!buckets.has(urlKey)) buckets.set(urlKey, []);
      if (hKey) alias.set(hKey, urlKey);
      return urlKey;
    }
    // Else headline-only bucket
    if (hKey) {
      if (!buckets.has(hKey)) buckets.set(hKey, []);
      alias.set(hKey, hKey);
      return hKey;
    }
    return null;
  }

  for (const page of recentPages) {
    const { urlKey, hKey } = buildKeys(page);
    console.log(`[keys] page ${page.id} urlKey=${urlKey || '-'} hKey=${hKey || '-'}`);

    const bucketId = chooseBucket(urlKey, hKey);
    if (!bucketId) continue;

    buckets.get(bucketId).push({
      id: page.id,
      created_time: page.created_time,
      headline: getHeadline(page),
      url: getPrimaryUrl(page),
      urlKey, hKey,
    });
  }

  console.log(`\nBucket count: ${buckets.size}`);
  let duplicatesArchived = 0;

  for (const [bucketId, items] of buckets.entries()) {
    if (items.length <= 1) continue;

    console.log(`\nGroup "${bucketId}" — ${items.length} items`);
    items.sort((a, b) => new Date(a.created_time) - new Date(b.created_time));

    // Show what we're grouping
    for (const it of items) {
      console.log(`  ${it.created_time}  ${it.id}  ${it.urlKey || ''} ${it.hKey || ''}`);
      console.log(`    "${(it.headline || '').slice(0, 120)}"`);
      console.log(`    ${it.url || ''}`);
    }

    // Keep earliest; archive the rest
    const toArchive = items.slice(1);
    for (const p of toArchive) {
      try {
        if (DRY_RUN) {
          console.log(`  [dry-run] Would archive ${p.id}`);
        } else {
          await notion.pages.update({ page_id: p.id, archived: true });
          console.log(`  Archived ${p.id}`);
          duplicatesArchived++;
          await delay(250);
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
