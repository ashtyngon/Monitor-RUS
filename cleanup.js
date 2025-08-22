// cleanup.js — archive duplicates in the last 90 days by normalized Headline/URL/Date
require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;

// ---------- same normalizers as index.js ----------
const SOURCE_SUFFIXES = [
  'медуза','медиазона','верстка','важные истории','новая газета','новая газета. европа',
  'агентство','the bell','эхо','дождь','тайга.инфо','bellingcat','овд-инфо','re:russia',
  'carnegie','dw','the guardian','associated press','радио свобода','настящее время',
  'bbc','русская служба би-би-си','астра','readovka','база','mash','кремль'
];

function normalizeTitle(raw = '') {
  let t = (raw || '').trim();
  const dashIdx = t.lastIndexOf(' - ');
  const mdashIdx = t.lastIndexOf(' — ');
  const idx = Math.max(dashIdx, mdashIdx);
  if (idx > -1) {
    const suffix = t.slice(idx + 3).toLowerCase().replace(/[«»“”"]/g, '').trim();
    if (SOURCE_SUFFIXES.some(s => suffix.includes(s))) t = t.slice(0, idx).trim();
  }
  t = t.replace(/[«»“”"]/g, '').replace(/\s+/g, ' ').trim();
  return t.toLowerCase();
}

function canonicalFromGoogle(link) {
  try {
    const u = new URL(link);
    if (!u.hostname.endsWith('news.google.com')) return null;
    const p = u.searchParams.get('url');
    return p || null;
  } catch { return null; }
}

function normalizeUrl(u) {
  if (!u) return '';
  try {
    const googleTarget = canonicalFromGoogle(u);
    if (googleTarget) u = googleTarget;

    const url = new URL(u);
    const junk = [
      'utm_source','utm_medium','utm_campaign','utm_term','utm_content','utm_id',
      'gclid','fbclid','oc','ocid','ref','referrer'
    ];
    junk.forEach(k => url.searchParams.delete(k));
    url.hash = '';
    url.hostname = url.hostname.replace(/^www\./, '');
    const path = url.pathname.replace(/\/+$/,'');
    const qs = url.searchParams.toString();
    return `${url.hostname}${path}${qs ? '?' + qs : ''}`.toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

function normalizeDateKey(dateString) {
  const d = new Date(dateString || Date.now());
  if (isNaN(d)) return '';
  const ms10 = 10 * 60 * 1000;
  const bucket = Math.round(d.getTime() / ms10) * ms10;
  return new Date(bucket).toISOString();
}

// ---------- Notion helpers ----------
async function fetchAllSince(daysBack = 90) {
  const since = new Date();
  since.setDate(since.getDate() - daysBack);
  const filter = {
    and: [
      { property: 'Date', date: { on_or_after: since.toISOString() } }
    ]
  };

  const acc = [];
  let cursor = undefined;
  do {
    const resp = await notion.databases.query({
      database_id: process.env.NOTION_DATABASE_ID,
      filter,
      sorts: [{ property: 'Date', direction: 'descending' }],
      start_cursor: cursor,
      page_size: 100
    });
    acc.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  return acc.map(p => ({
    id: p.id,
    date: p.properties?.Date?.date?.start || null,
    title: p.properties?.Headline?.title?.map(t => t?.plain_text).join(' ') || '',
    url: p.properties?.URL?.url || '',
    source: p.properties?.Source?.rich_text?.map(t => t?.plain_text).join(' ') || '',
    short: p.properties?.Short?.rich_text?.map(t => t?.plain_text).join(' ') || ''
  }));
}

async function archivePage(id) {
  await notion.pages.update({ page_id: id, archived: true });
}

// Prefer non-Google URL; if tie, prefer the one that has a URL at all; else earliest date
function chooseKeeper(items) {
  const nonGoogle = items.filter(i => !(i.url || '').includes('news.google.com'));
  if (nonGoogle.length) return nonGoogle[0];
  const withUrl = items.filter(i => i.url);
  if (withUrl.length) return withUrl[0];
  return items[0];
}

(async function run() {
  console.log('Scanning last 90 days for duplicates...');
  const pages = await fetchAllSince(90);

  // group candidates by normalized keys
  const groups = new Map();

  for (const p of pages) {
    const kTitle = normalizeTitle(p.title);
    const kUrl   = normalizeUrl(p.url);
    const kDate  = normalizeDateKey(p.date);

    // Build group IDs: by title, by url, by title+date
    const keys = new Set([`t:${kTitle}`, kUrl ? `u:${kUrl}` : '', `td:${kTitle}::${kDate}`].filter(Boolean));

    // Find existing group to merge into if any key already exists
    let groupId = null;
    for (const key of keys) {
      if (groups.has(key)) { groupId = key; break; }
    }
    if (!groupId) groupId = [...keys][0]; // pick first key as anchor

    // ensure all keys map to the same array (union)
    const arr = groups.get(groupId) || [];
    arr.push(p);
    groups.set(groupId, arr);
    for (const key of keys) groups.set(key, arr); // alias keys to same list
  }

  // decide duplicates inside each real group
  const visited = new Set();
  let archived = 0;

  for (const [key, arr] of groups) {
    if (visited.has(arr)) continue;
    visited.add(arr);

    if (arr.length <= 1) continue;

    // Choose one to keep and archive the rest
    const keep = chooseKeeper(arr);
    const toArchive = arr.filter(x => x.id !== keep.id);

    for (const dup of toArchive) {
      try {
        await archivePage(dup.id);
        archived++;
        console.log(`[ARCHIVED] ${dup.title} (${dup.url})`);
      } catch (e) {
        console.error(`Failed to archive ${dup.id}: ${e.message}`);
      }
    }
  }

  console.log(`Done. Archived ${archived} duplicates.`);
})().catch(err => {
  console.error('Cleanup fatal error:', err);
  process.exit(1);
});
