require('dotenv').config();
const { Client } = require('@notionhq/client');
const Parser = require('rss-parser');

// --- Notion & RSS setup
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const parser = new Parser();
const databaseId = process.env.NOTION_DATABASE_ID;

// --- Feeds (FIXED: Updated and verified RSS feed URLs)
const feeds = [
const feeds = [
  { name: 'Медуза', url: 'https://news.google.com/rss/search?q=site:meduza.io&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Инсайдер', url: 'https://news.google.com/rss/search?q=site:theins.ru&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Медиазона', url: 'https://news.google.com/rss/search?q=site:zona.media&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Re:Russia', url: 'https://news.google.com/rss/search?q=site:re-russia.net&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Русская служба Би-би-си', url: 'https://feeds.bbci.co.uk/russian/rss.xml' },
  { name: 'Верстка', url: 'https://news.google.com/rss/search?q=site:verstka.media&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Новая газета', url: 'https://news.google.com/rss/search?q=site:novayagazeta.ru&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Новая газета. Европа', url: 'https://news.google.com/rss/search?q=site:novayagazeta.eu&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Агентство', url: 'https://news.google.com/rss/search?q=site:agents.media&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'The Bell', url: 'https://news.google.com/rss/search?q=site:thebell.io&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Эхо', url: 'https://news.google.com/rss/search?q=site:echofm.online&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Настоящее Время', url: 'https://news.google.com/rss/search?q=site:currenttime.tv&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Дождь', url: 'https://news.google.com/rss/search?q=site:tvrain.tv&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Можем объяснить', url: 'https://rss.bridges.eqy.ch/?action=display&bridge=TelegramBridge&username=mozhemobyasnit&format=Mrss' },
  { name: 'Тайга.инфо', url: 'https://news.google.com/rss/search?q=site:tayga.info&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Проект', url: 'https://news.google.com/rss/search?q=site:proekt.media&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Carnegie', url: 'https://news.google.com/rss/search?q=Russia+site:carnegieendowment.org&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Радио Свобода', url: 'https://news.google.com/rss/search?q=site:svoboda.org&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'DW (на русском)', url: 'https://rss.dw.com/rdf/rss-ru-news' },
  { name: 'The Guardian', url: 'https://www.theguardian.com/world/russia/rss' },
  { name: 'Досье', url: 'https://news.google.com/rss/search?q=site:dossier.center&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Associated Press (Russia)', url: 'https://news.google.com/rss/search?q=Russia+site:apnews.com&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Bellingcat (RU)', url: 'https://news.google.com/rss/search?q=site:ru.bellingcat.com&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Важные истории', url: 'https://news.google.com/rss/search?q=site:istories.media&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'ОВД-Инфо', url: 'https://news.google.com/rss/search?q=site:ovd.info&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'ОВД-Инфо (Доклады)', url: 'https://news.google.com/rss/search?q=site:reports.ovd.info&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'База', url: 'https://news.google.com/rss/search?q=site:baza.io&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Faridaily (RU)', url: 'https://faridaily.ru/feed' },
  { name: 'Faridaily (EN)', url: 'https://faridaily.substack.com/feed' },
  { name: 'Mash', url: 'https://news.google.com/rss/search?q=site:mash.ru&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Astra', url: 'https://news.google.com/rss/search?q=site:astra.press&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Readovka', url: 'https://news.google.com/rss/search?q=site:readovka.news&hl=ru&gl=RU&ceid=RU:ru' },
  { name: 'Кремль', url: 'http://www.kremlin.ru/events/all/feed' },
];
  

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

    // Process only latest 20 items to avoid overload
    const itemsToProcess = parsed.items.slice(0, 20);

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
