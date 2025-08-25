// index.js — Final script to fetch feeds and prevent new duplicates
require('dotenv').config();
const { Client } = require('@notionhq/client');
const Parser = require('rss-parser');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const parser = new Parser();
const databaseId = process.env.NOTION_DATABASE_ID;

const feeds = [
  // Your full list of feeds here...
  { name: 'Медуза', url: 'https://news.google.com/rss/search?q=site:meduza.io&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Русская служба Би-би-си', url: 'https://feeds.bbci.co.uk/russian/rss.xml' },
  // etc.
];

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- Normalizers (no changes) ----------
const SOURCE_SUFFIXES = [
  'медуза','медиазона','верстка','важные истории','новая газета','новая газета. европа',
  'агентство','the bell','эхо','дождь','тайга.инфо','bellingcat','овд-инфо','re:russia',
  'carnegie','dw','the guardian','associated press','радио свобода','настящее время',
  'bbc','русская служба би-би-си','астра','readovka','база','mash','кремль'
];
function stripHtml(str = '') { return String(str).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function extractBody(item) {
  const encoded = item['content:encoded'] || item.content;
  const desc = item.description || item.summary || item.contentSnippet;
  const combined = [encoded, desc].filter(Boolean).join(' ');
  return stripHtml(combined);
}
function normalizeTitle(raw = '') {
  let t = raw.trim();
  const dashIdx = t.lastIndexOf(' - ');
  const mdashIdx = t.lastIndexOf(' — ');
  const idx = Math.max(dashIdx, mdashIdx);
  if (idx > -1) {
    const suffix = t.slice(idx + 3).toLowerCase().replace(/^«|»|“|”|"|'|«|»/g, '').trim();
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
    if (p) return p;
    return null;
  } catch { return null; }
}
function normalizeUrl(u) {
  if (!u) return '';
  try {
    const googleTarget = canonicalFromGoogle(u);
    if (googleTarget) u = googleTarget;
    const url = new URL(u);
    const throwaway = [
      'utm_source','utm_medium','utm_campaign','utm_term','utm_content','utm_id',
      'gclid','fbclid','oc','ocid','ref','referrer'
    ];
    throwaway.forEach(k => url.searchParams.delete(k));
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
function firstSentences(text, maxSentences = 3) {
  const t = stripHtml(text);
  if (!t) return 'No short text';
  const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.slice(0, Math.max(2, Math.min(maxSentences, parts.length))).join(' ') || t.slice(0, 250);
}
function convertDatePlus8Hours(dateString) {
  const d = new Date(dateString || Date.now());
  if (!isNaN(d)) d.setHours(d.getHours() + 8);
  return d;
}
function chunkText(txt, size = 2000) {
  const out = [];
  for (let i = 0; i < txt.length; i += size) out.push(txt.slice(i, i + size));
  return out.length ? out : [''];
}

// ---------- Notion Functions ----------
async function addToNotion(item, source) {
  const title = item.title || '(no title)';
  const link  = item.link  || '';
  const date  = convertDatePlus8Hours(item.pubDate || item.isoDate || new Date());
  const body  = extractBody(item);
  const shortText = firstSentences(body, 3);
  const chunks = chunkText(body, 2000);
  const dedupeKey = normalizeUrl(link);

  const blocksToAdd = chunks.slice(0, 25).map((chunk) => ({
    object: 'block',
    paragraph: { rich_text: [{ type: 'text', text: { content: chunk } }] }
  }));

  await notion.pages.create({
    parent: { database_id: databaseId },
    properties: {
      Date: { date: { start: date.toISOString() } },
      Headline: { title: [{ text: { content: title } }] },
      Short: { rich_text: [{ text: { content: shortText } }] },
      Source: { rich_text: [{ text: { content: source } }] },
      URL: link ? { url: link } : { url: null },
      'Dedupe Key': { rich_text: [{ text: { content: dedupeKey } }] }
    },
    children: blocksToAdd
  });
}

async function getExistingKeys(databaseId) {
    const existingKeys = new Set();
    let cursor = undefined;
    console.log('Fetching existing article keys from Notion to prevent duplicates...');
    try {
        while (true) {
            const { results, next_cursor } = await notion.databases.query({
                database_id: databaseId,
                filter: { property: "Dedupe Key", rich_text: { is_not_empty: true } },
                page_size: 100,
                start_cursor: cursor,
            });
            for (const page of results) {
                const prop = page.properties['Dedupe Key'];
                if (prop?.rich_text?.[0]?.plain_text) {
                    existingKeys.add(`u:${prop.rich_text[0].plain_text}`);
                }
            }
            if (!next_cursor) break;
            cursor = next_cursor;
        }
    } catch (error) {
        console.error("Error fetching keys from Notion. Is the 'Dedupe Key' property correct?", error.message);
    }
    console.log(`Found ${existingKeys.size} existing articles in Notion.`);
    return existingKeys;
}

// ---------- Main Processing Logic ----------
async function processFeed(feed, seen) {
  try {
    const parsed = await parser.parseURL(feed.url);
    if (!parsed?.items?.length) {
      console.warn(`No items from: ${feed.name} (${feed.url})`);
      return;
    }
    for (const item of parsed.items.slice(0, 20)) {
      const title = (item.title || '').trim();
      const link  = (item.link  || '').trim();
      const nUrl  = normalizeUrl(link);

      // Main dedupe check using the normalized URL
      const urlKey = nUrl ? `u:${nUrl}` : '';
      if (urlKey && seen.has(urlKey)) {
        continue;
      }

      await addToNotion(item, feed.name);
      console.log(`Added: [${feed.name}] ${title}`);

      // Add the new key to the set to prevent in-run duplicates
      if (urlKey) seen.add(urlKey);

      await delay(120);
    }
  } catch (err) {
    console.error(`Fetch/parse failed for ${feed.name}: ${err.message}`);
  }
}

(async function run() {
  console.log(`Processing ${feeds.length} feeds...`);
  const seen = await getExistingKeys(databaseId);
  for (const feed of feeds) {
    await processFeed(feed, seen);
    await delay(300);
  }
  console.log('Done.');
})().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
