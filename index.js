// index.js — fast fetcher with in-run dedupe by normalized Headline/URL/Date
require('dotenv').config();
const { Client } = require('@notionhq/client');
const Parser = require('rss-parser');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const parser = new Parser();
const databaseId = process.env.NOTION_DATABASE_ID;

// ---- feeds (same as your current list) ----
const feeds = [
  { name: 'Медуза', url: 'https://news.google.com/rss/search?q=site:meduza.io&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Инсайдер', url: 'https://news.google.com/rss/search?q=site:theins.ru&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Медиазона', url: 'https://news.google.com/rss/search?q=site:zona.media&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Верстка', url: 'https://news.google.com/rss/search?q=site:verstka.media&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Важные истории', url: 'https://news.google.com/rss/search?q=site:istories.media&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Новая газета', url: 'https://news.google.com/rss/search?q=site:novayagazeta.ru&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Новая газета. Европа', url: 'https://news.google.com/rss/search?q=site:novayagazeta.eu&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Агентство', url: 'https://news.google.com/rss/search?q=site:agents.media&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'The Bell', url: 'https://news.google.com/rss/search?q=site:thebell.io&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Эхо', url: 'https://news.google.com/rss/search?q=site:echofm.online&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Дождь', url: 'https://news.google.com/rss/search?q=site:tvrain.tv&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Тайга.инфо', url: 'https://news.google.com/rss/search?q=site:tayga.info&hl=ru&gl=RU&ceid=RU:ru' },

  { name: 'Проект', url: 'https://news.google.com/rss/search?q=site:proekt.media&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Досье', url: 'https://news.google.com/rss/search?q=site:dossier.center&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Bellingcat (RU)', url: 'https://news.google.com/rss/search?q=site:ru.bellingcat.com&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'ОВД-Инфо', url: 'https://news.google.com/rss/search?q=site:ovd.info&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'ОВД-Инфо (Доклады)', url: 'https://news.google.com/rss/search?q=site:reports.ovd.info&hl=ru&gl=RU&ceid=RU:ru' },

  { name: 'Re:Russia', url: 'https://news.google.com/rss/search?q=site:re-russia.net&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Carnegie (Russia/Eurasia)', url: 'https://news.google.com/rss/search?q=Russia+site:carnegieendowment.org&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Faridaily (RU)', url: 'https://faridaily.ru/feed' },
  { name: 'Faridaily (EN)', url: 'https://faridaily.substack.com/feed' },

  { name: 'Русская служба Би-би-си', url: 'https://feeds.bbci.co.uk/russian/rss.xml' },
  { name: 'Настоящее Время', url: 'https://news.google.com/rss/search?q=site:currenttime.tv&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Радио Свобода', url: 'https://news.google.com/rss/search?q=site:svoboda.org&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'DW (на русском)', url: 'https://rss.dw.com/rdf/rss-ru-news' },
  { name: 'The Guardian', url: 'https://www.theguardian.com/world/russia/rss' },
  { name: 'Associated Press (Russia)', url: 'https://news.google.com/rss/search?q=Russia+site:apnews.com&hl=ru&gl=RU&ceid=RU:ru' },

  { name: 'Можем объяснить', url: 'https://rss.bridges.eqy.ch/?action=display&bridge=TelegramBridge&username=mozhemobyasnit&format=Mrss' },
  { name: 'База', url: 'https://news.google.com/rss/search?q=site:baza.io&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Mash', url: 'https://news.google.com/rss/search?q=site:mash.ru&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Astra', url: 'https://news.google.com/rss/search?q=site:astra.press&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Readovka', url: 'https://news.google.com/rss/search?q=site:readovka.news&hl=ru&gl=RU&ceid=RU:ru' },

  { name: 'Кремль', url: 'http://www.kremlin.ru/events/all/feed' },
];

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- Normalizers ----------
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
  // remove typical trailing " - Source" / " — Source"
  const dashIdx = t.lastIndexOf(' - ');
  const mdashIdx = t.lastIndexOf(' — ');
  const idx = Math.max(dashIdx, mdashIdx);
  if (idx > -1) {
    const suffix = t.slice(idx + 3).toLowerCase().replace(/^«|»|“|”|"|'|«|»/g, '').trim();
    if (SOURCE_SUFFIXES.some(s => suffix.includes(s))) t = t.slice(0, idx).trim();
  }
  // also remove enclosing quotes and excess spaces
  t = t.replace(/[«»“”"]/g, '').replace(/\s+/g, ' ').trim();
  return t.toLowerCase();
}

function canonicalFromGoogle(link) {
  try {
    const u = new URL(link);
    if (!u.hostname.endsWith('news.google.com')) return null;
    const p = u.searchParams.get('url');
    if (p) return p;
    // Some GN links don’t expose ?url=; keep as-is
    return null;
  } catch { return null; }
}

function normalizeUrl(u) {
  if (!u) return '';
  try {
    const googleTarget = canonicalFromGoogle(u);
    if (googleTarget) u = googleTarget;

    const url = new URL(u);
    // strip tracking params
    const throwaway = [
      'utm_source','utm_medium','utm_campaign','utm_term','utm_content','utm_id',
      'gclid','fbclid','oc','ocid','ref','referrer'
    ];
    throwaway.forEach(k => url.searchParams.delete(k));
    url.hash = ''; // no fragments

    url.hostname = url.hostname.replace(/^www\./, '');
    const path = url.pathname.replace(/\/+$/,'');
    const qs = url.searchParams.toString();
    return `${url.hostname}${path}${qs ? '?' + qs : ''}`.toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

function normalizeDateKey(dateString) {
  // Round to nearest 10 minutes so tiny feed time skews don't block matches
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

// ---------- Notion create ----------
async function addToNotion(item, source) {
  const title = item.title || '(no title)';
  const link  = item.link  || '';
  const date  = convertDatePlus8Hours(item.pubDate || item.isoDate || new Date());
  const body  = extractBody(item);
  const shortText = firstSentences(body, 3);
  const chunks = chunkText(body, 2000);

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
      URL: link ? { url: link } : { url: null }
    },
    children: blocksToAdd
  });
}

// ---------- fast processing with in-run dedupe ----------
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
      const body  = extractBody(item);
      if (!(body.length >= 80 || title.length >= 50)) {
        console.warn(`Skipping short item: [${feed.name}] ${title}`);
        continue;
      }

      const nTitle = normalizeTitle(title);
      const nUrl   = normalizeUrl(link);
      const nDate  = normalizeDateKey(item.pubDate || item.isoDate || new Date());

      // De-dupe: if we already saw same normalized title OR same URL OR same (title+date)
      const k1 = `t:${nTitle}`;
      const k2 = nUrl ? `u:${nUrl}` : '';
      const k3 = `td:${nTitle}::${nDate}`;

      if (seen.has(k1) || (k2 && seen.has(k2)) || seen.has(k3)) continue;

      await addToNotion(item, feed.name);
      console.log(`Added: [${feed.name}] ${title}`);

      seen.add(k1);
      if (k2) seen.add(k2);
      seen.add(k3);

      await delay(120);
    }
  } catch (err) {
    console.error(`Fetch/parse failed for ${feed.name}: ${err.message}`);
  }
}

(async function run() {
  console.log(`Processing ${feeds.length} feeds...`);
  const seen = new Set();
  for (const feed of feeds) {
    await processFeed(feed, seen);
    await delay(300);
  }
  console.log('Done.');
})().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
