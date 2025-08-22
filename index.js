require('dotenv').config();
const { Client } = require('@notionhq/client');
const Parser = require('rss-parser');

// --- Notion & RSS setup
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const parser = new Parser();
const databaseId = process.env.NOTION_DATABASE_ID;

// --- Feeds (FIXED: removed duplicate declarations)
const feeds = [
  { name: 'Медуза', url: 'https://meduza.io/rss/all' },
  { name: 'Инсайдер', url: 'https://theins.ru/feed' },
  { name: 'Медиазона', url: 'https://zona.media/rss' },
  { name: 'Re:Russia', url: 'https://rss.app/feeds/407wNrMr23sxZy4E.xml' },
  { name: 'Русская служба Би-би-си', url: 'https://feeds.bbci.co.uk/russian/rss.xml' },
  { name: 'Верстка', url: 'https://rss.app/feeds/iOGN8vsmRgHrnpf1.xml' },
  { name: 'Новая газета', url: 'https://novayagazeta.ru/rss' },
  { name: 'Новая газета. Европа', url: 'https://news.google.com/rss/search?q=site:novayagazeta.eu' },
  { name: 'Агентство', url: 'https://www.agents.media/feed/' },
  { name: 'The Bell', url: 'https://thebell.io/feed' },
  { name: 'MBK Tg', url: 'https://rss.app/feeds/JIQAV4lBG1jflGD7.xml' },
  { name: 'Эхо', url: 'https://echo.msk.ru/news/rss/full.xml' },
  { name: 'Настоящее Время', url: 'https://www.currenttime.tv/api/epiqq' },
  { name: 'Дождь', url: 'https://tvrain.tv/export/rss/programs/1018.xml' },
  { name: 'Радио Свобода', url: 'https://www.svoboda.org/api/zrqiteuuir' },
  { name: 'DW (на русском)', url: 'https://rss.dw.com/rdf/rss-ru-news' },
  { name: 'The Guardian Russia', url: 'https://www.theguardian.com/world/russia/rss' },
  { name: 'Bloomberg (Google News)', url: 'https://news.google.com/rss/search?q=russia+allinurl:bloomberg.com' },
  { name: 'Досье (Google News)', url: 'https://news.google.com/rss/search?q=site:dossier.center' },
  { name: 'Associated Press (Russia)', url: 'https://news.google.com/rss/search?q=site:apnews.com/hub/russia' },
  { name: 'Важные истории', url: 'https://rss.app/feeds/YYXfotYcZesnp8l5.xml' },
  { name: 'База', url: 'https://rss.app/feeds/4UQ45HbEOD5Halla.xml' },
  { name: 'Осторожно, новости', url: 'https://rss.app/feeds/EoNHevp1Fl0CUNVH.xml' },
  { name: 'Shot', url: 'https://rss.app/feeds/yp4NcmRgkZWeM7w7.xml' },
  { name: 'Mash', url: 'https://rss.app/feeds/95fP9lFhI5M5UsFP.xml' },
  { name: 'Astra', url: 'https://rss.app/feeds/rq7pkWq58BDCi4HR.xml' },
  { name: 'Readovka', url: 'https://rss.app/feeds/Tvps748fD9PxqUNd.xml' },
  { name: 'ВЧК-ОГПУ', url: 'https://rss.app/feeds/09MUbRvW7bvQyy4t.xml' },
];

// --- Add delay to avoid rate limits
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- Helpers
function convertDatePlus8Hours(dateString) {
  if (!dateString) return new Date();
  const d = new Date(dateString);
  if (isNaN(d)) return new Date();
  d.setHours(d.getHours() + 8);
  return d;
}

function stripHtml(str = '') {
  // very basic sanitizer to avoid extra deps
  return String(str).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function firstSentences(text, maxSentences = 3) {
  const t = stripHtml(text);
  if (!t) return 'No short text';
  const parts = t.split(/(?<=[\.\!\?])\s+/).filter(Boolean);
  const snip = parts.slice(0, Math.max(2, Math.min(maxSentences, parts.length))).join(' ');
  return snip || t.slice(0, 250);
}

async function existsInNotion(source, title, link) {
  try {
    // Query by Source + (exact Headline OR exact URL)
    const resp = await notion.databases.query({
      database_id: databaseId,
      filter: {
        and: [
          { property: 'Source', rich_text: { equals: source } },
          {
            or: [
              { property: 'Headline', title: { equals: title || '' } },
              { property: 'URL', url: { equals: link || '' } }
            ]
          }
        ]
      }
    });
    return resp.results.length > 0;
  } catch (error) {
    console.error(`Error checking existence: ${error.message}`);
    return false; // On error, assume doesn't exist
  }
}

function chunkText(txt, size = 2000) {
  const out = [];
  for (let i = 0; i < txt.length; i += size) out.push(txt.slice(i, i + size));
  return out.length ? out : [''];
}

async function addToNotion(item, source) {
  try {
    const title = item.title || '(no title)';
    const link = item.link || '';
    const date = convertDatePlus8Hours(item.pubDate || item.isoDate || new Date());
    const body =
      stripHtml(item.contentSnippet || item.content || item.summary || item['content:encoded'] || '');
    const shortText = firstSentences(body, 3);
    const chunks = chunkText(body, 2000);

    // Limit to 25 blocks (Notion limit)
    const blocksToAdd = chunks.slice(0, 25).map((chunk) => ({
      object: 'block',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: chunk } }]
      }
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
    
    return true;
  } catch (error) {
    console.error(`Failed to add to Notion: ${error.message}`);
    if (error.code === 'rate_limited') {
      console.log('Rate limited, waiting...');
      await delay(5000);
    }
    return false;
  }
}

async function processFeed(feed) {
  try {
    const parsed = await parser.parseURL(feed.url);
    if (!parsed?.items?.length) {
      console.warn(`No items from: ${feed.name} (${feed.url})`);
      return;
    }

    // Process only latest 10 items to avoid overload
    const itemsToProcess = parsed.items.slice(0, 10);

    for (const item of itemsToProcess) {
      const title = item.title || '';
      const link = item.link || '';
      const seen = await existsInNotion(feed.name, title, link);
      if (seen) continue;

      try {
        const added = await addToNotion(item, feed.name);
        if (added) {
          console.log(`Added: [${feed.name}] ${title}`);
          await delay(200); // Small delay between API calls
        }
      } catch (createErr) {
        console.error(`Create failed for ${feed.name}: ${createErr.message}`);
      }
    }
  } catch (err) {
    console.error(`Fetch/parse failed for ${feed.name}: ${err.message}`);
  }
}

(async function run() {
  console.log(`Processing ${feeds.length} feeds...`);
  
  for (const feed of feeds) {
    await processFeed(feed);
    await delay(500); // Delay between feeds
  }
  
  console.log('Done.');
})().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
