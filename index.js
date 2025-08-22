// index.js
require('dotenv').config();
const { Client } = require('@notionhq/client');
const Parser = require('rss-parser');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const parser = new Parser();
const databaseId = process.env.NOTION_DATABASE_ID;

/* -------------------- FEEDS -------------------- */
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

/* -------------------- UTIL -------------------- */
const delay = (ms) => new Promise(r => setTimeout(r, ms));

function stripHtml(str = '') {
  return String(str).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function firstSentences(text, maxSentences = 3) {
  const t = stripHtml(text);
  if (!t) return 'No short text';
  const parts = t.split(/(?<=[\.\!\?])\s+/).filter(Boolean);
  const snip = parts.slice(0, Math.max(2, Math.min(maxSentences, parts.length))).join(' ');
  return snip || t.slice(0, 250);
}

function extractBody(item) {
  const encoded = item['content:encoded'] || item.content;
  const desc = item.description || item.summary || item.contentSnippet;
  const combined = [encoded, desc].filter(Boolean).join(' ');
  return stripHtml(combined).trim();
}

function convertDatePlus8Hours(dateString) {
  if (!dateString) return new Date();
  const d = new Date(dateString);
  if (isNaN(d)) return new Date();
  d.setHours(d.getHours() + 8);
  return d;
}

function chunkText(txt, size = 2000) {
  const out = [];
  for (let i = 0; i < txt.length; i += size) out.push(txt.slice(i, i + size));
  return out.length ? out : [''];
}

/* --------- WIDE DEDUPE HELPERS --------- */
const TRACKING_PARAMS = new Set(['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid','at_campaign','at_medium','at_source','yclid','mc_cid','mc_eid']);

function unwrapGoogleNews(link) {
  try {
    const u = new URL(link);
    if (u.hostname.endsWith('news.google.com')) {
      const real = u.searchParams.get('url') || u.searchParams.get('u');
      if (real) return real;
    }
    return link;
  } catch { return link; }
}

function normalizeUrl(link) {
  if (!link) return '';
  try {
    let href = unwrapGoogleNews(link);
    const u = new URL(href);
    let host = u.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    const kept = [];
    for (const [k, v] of u.searchParams.entries()) {
      if (!TRACKING_PARAMS.has(k.toLowerCase())) kept.push([k, v]);
    }
    kept.sort((a, b) => a[0].localeCompare(b[0]));
    const query = kept.length ? '?' + kept.map(([k, v]) => `${k}=${v}`).join('&') : '';
    let path = u.pathname || '/';
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return `${host}${path}${query}`;
  } catch { return link.trim(); }
}

function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[“”"«»„‟’'`´]/g, '')
    .replace(/[–—\-–]+/g, ' ')
    .replace(/[\(\)\[\]\{\}|•·~]/g, ' ')
    .replace(/[^a-zа-я0-9ё\.\?!\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleKey(title, maxWords = 10) {
  const t = normalizeTitle(title);
  const words = t.split(' ').filter(Boolean);
  return words.slice(0, Math.min(maxWords, words.length)).join(' ');
}

/* --------- BUILD NOTION INDEX --------- */
async function buildRecentIndex(days = 90) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const seenUrl = new Set();
  const seenTitle = new Set();
  let hasMore = true, cursor;

  while (hasMore) {
    const resp = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      filter: { property: 'Date', date: { on_or_after: since.toISOString() } },
      page_size: 100
    });
    for (const page of resp.results) {
      const props = page.properties || {};
      const titleProp = props.Headline?.title || [];
      const urlProp = props.URL?.url || '';
      const t = titleProp.map(x => x.plain_text).join('');
      const tk = titleKey(t);
      if (tk) seenTitle.add(tk);
      const uk = normalizeUrl(urlProp || '');
      if (uk) seenUrl.add(uk);
    }
    hasMore = resp.has_more;
    cursor = resp.next_cursor;
  }
  return { seenUrl, seenTitle };
}

/* --------- NOTION WRITE --------- */
async function addToNotion(item, source) {
  const title = item.title || '(no title)';
  const link = item.link || '';
  const date = convertDatePlus8Hours(item.pubDate || item.isoDate || new Date());
  const body = extractBody(item);
  const shortText = firstSentences(body, 3);
  const chunks = chunkText(body, 2000);
  const blocks = chunks.slice(0, 25).map(chunk => ({
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
    children: blocks
  });
}

/* --------- MAIN --------- */
(async function run() {
  console.log(`Building 90-day dedupe index...`);
  const { seenUrl, seenTitle } = await buildRecentIndex(90);
  console.log(`Loaded index: ${seenUrl.size} urls, ${seenTitle.size} titles`);
  console.log(`Processing ${feeds.length} feeds...`);

  for (const feed of feeds) {
    try {
      const parsed = await parser.parseURL(feed.url);
      const items = parsed.items.slice(0, 20);
      for (const item of items) {
        const title = item.title || '';
        const link = item.link || '';
        const body = extractBody(item);
        if (body.length < 80 && title.length < 50) continue;

        const uk = normalizeUrl(link);
        const tk = titleKey(title);
        if (seenUrl.has(uk) || seenTitle.has(tk)) continue;

        await addToNotion(item, feed.name);
        console.log(`Added: [${feed.name}] ${title}`);
        seenUrl.add(uk);
        seenTitle.add(tk);
        await delay(200);
      }
    } catch (err) {
      console.error(`Fetch/parse failed for ${feed.name}: ${err.message}`);
    }
    await delay(500);
  }
  console.log('Done.');
})().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
