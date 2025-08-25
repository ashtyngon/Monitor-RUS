// index.js — Fetches new articles and prevents duplicates
require('dotenv').config();
const { Client } = require('@notionhq/client');
const Parser = require('rss-parser');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const parser = new Parser();
const databaseId = process.env.NOTION_DATABASE_ID;

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
  { name: 'Re:Russia', url: 'https://news.google.com/rss/search?q=site:re-russia.net&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Carnegie (Russia/Eurasia)', url: 'https://news.google.com/rss/search?q=Russia+site:carnegieendowment.org&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Faridaily (RU)', url: 'https://faridaily.ru/feed' },
  { name: 'Русская служба Би-би-си', url: 'https://feeds.bbci.co.uk/russian/rss.xml' },
  { name: 'Настоящее Время', url: 'https://news.google.com/rss/search?q=site:currenttime.tv&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Радио Свобода', url: 'https://news.google.com/rss/search?q=site:svoboda.org&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'DW (на русском)', url: 'https://rss.dw.com/rdf/rss-ru-news' },
  { name: 'The Guardian', url: 'https://www.theguardian.com/world/russia/rss' },
];

const delay = (ms) => new Promise(r => setTimeout(r, ms));

function canonicalFromGoogle(link) {
  try {
    const u = new URL(link);
    if (!u.hostname.endsWith('news.google.com')) return null;
    return u.searchParams.get('url') || null;
  } catch { return null; }
}

function normalizeUrl(u) {
  if (!u) return '';
  try {
    const googleTarget = canonicalFromGoogle(u);
    if (googleTarget) u = googleTarget;
    const url = new URL(u);
    const junkParams = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','ref','fbclid'];
    junkParams.forEach(p => url.searchParams.delete(p));
    url.hash = '';
    url.hostname = url.hostname.replace(/^www\./, '');
    const path = url.pathname.replace(/\/+$/,'');
    const qs = url.searchParams.toString();
    return `${url.hostname}${path}${qs ? '?' + qs : ''}`.toLowerCase();
  } catch { return u.trim().toLowerCase(); }
}

async function getExistingKeys(dbId) {
    const existingKeys = new Set();
    let cursor = undefined;
    console.log('Fetching existing article keys from Notion...');
    try {
        while (true) {
            const { results, next_cursor } = await notion.databases.query({
                database_id: dbId,
                filter: { property: "Dedupe Key", rich_text: { is_not_empty: true } },
                page_size: 100,
                start_cursor: cursor,
            });
            for (const page of results) {
                const prop = page.properties['Dedupe Key'];
                if (prop?.rich_text?.[0]?.plain_text) {
                    existingKeys.add(prop.rich_text[0].plain_text);
                }
            }
            if (!next_cursor) break;
            cursor = next_cursor;
        }
    } catch (e) {
        console.error("Fatal: Could not fetch keys from Notion. Is the 'Dedupe Key' property correctly named and of type 'Text'?", e.message);
        throw e; // Stop execution if we can't verify duplicates
    }
    console.log(`Found ${existingKeys.size} existing articles in Notion.`);
    return existingKeys;
}

async function addToNotion(item, source) {
  const link = item.link || '';
  const dedupeKey = normalizeUrl(link);
  if (!dedupeKey) {
      console.warn(`Skipping item with no valid URL: "${item.title}"`);
      return;
  }

  await notion.pages.create({
    parent: { database_id: databaseId },
    properties: {
      'Headline': { title: [{ text: { content: item.title || '(no title)' } }] },
      'URL': { url: link },
      'Source': { rich_text: [{ text: { content: source } }] },
      'Date': { date: { start: new Date(item.isoDate || Date.now()).toISOString() } },
      'Dedupe Key': { rich_text: [{ text: { content: dedupeKey } }] }
    }
  });
}

async function processFeed(feed, seenKeys) {
  try {
    const parsed = await parser.parseURL(feed.url);
    if (!parsed?.items?.length) {
      console.warn(`No items from: ${feed.name}`);
      return;
    }
    for (const item of parsed.items) {
      const nUrl = normalizeUrl(item.link);
      if (nUrl && !seenKeys.has(nUrl)) {
        await addToNotion(item, feed.name);
        seenKeys.add(nUrl); // Add to set so we don't add it again this run
        console.log(`Added: [${feed.name}] ${item.title}`);
        await delay(200);
      }
    }
  } catch (err) {
    console.error(`Failed to process feed ${feed.name}: ${err.message}`);
  }
}

(async function main() {
  const seenKeys = await getExistingKeys(databaseId);
  console.log(`\nProcessing ${feeds.length} feeds...`);
  for (const feed of feeds) {
    await processFeed(feed, seenKeys);
  }
  console.log('\nDone.');
})().catch(err => {
  console.error('A fatal error occurred in the main process:', err);
  process.exit(1);
});
