require('dotenv').config();
const { Client } = require('@notionhq/client');
const Parser = require('rss-parser');

// 1) Initialize Notion + RSS parser
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const parser = new Parser();

// 2) Your feeds
const feeds = [
  { name: 'Медуза', url: 'https://meduza.io/rss/all' },
  { name: 'Инсайдер', url: 'https://theins.ru/feed' },
  { name: 'Медиазона', url: 'https://zona.media/rss' },
  // Example for Re:Russia using an RSS.app link
  { name: 'Re:Russia', url: 'https://rss.app/feeds/407wNrMr23sxZy4E.xml' },
  { name: 'Холод', url: 'https://holod.media/feed' },
  { name: 'Русская служба Би-би-си', url: 'http://feeds.bbci.co.uk/russian/rss.xml' },
  { name: 'Верстка', url: 'https://rss.app/feeds/iOGN8vsmRgHrnpf1.xml' },
  { name: 'Новая газета', url: 'https://novayagazeta.ru/rss' },
  // Two different “Новая газета. Европа” RSS links
  { name: 'Новая газета. Европа', url: 'https://rss.app/feeds/pPzIBllexkCT3MqR.xml' },
  { name: 'Новая газета. Европа', url: 'https://rss.app/feeds/vdXv5kXzFa4IWki7.xml' },
  // Two different “Агентство” RSS links
  { name: 'Агентство', url: 'https://rss.app/feeds/YrL7Ml9AxJqQXZU8.xml' },
  { name: 'Агентство', url: 'https://rss.app/feeds/MZose7CCrJl0ImQC.xml' },
  { name: 'The Bell', url: 'https://thebell.io/feed' },
  { name: 'Tg/МБХ', url: 'https://t.me/s/khodorkovski' },
];

// 3) Notion database from .env
const databaseId = process.env.NOTION_DATABASE_ID;

/**
 * Convert feed's pubDate by adding 8 hours.
 * If it's 2:20 pm in NYC and the feed says 14:20 local,
 * we get 22:20 (10:20 pm) with an 8-hour offset.
 */
function convertDatePlus8Hours(dateString) {
  if (!dateString) return null;
  const originalDate = new Date(dateString);
  if (isNaN(originalDate)) return null;

  // Add 8 hours to the date
  return new Date(originalDate.getTime() + 8 * 60 * 60 * 1000);
}

/**
 * Return the first 2–3 sentences as a snippet.
 */
function getShortVersion(text) {
  if (!text) return 'No short text';
  const sentences = text.split('.').filter(Boolean);
  const snippet = sentences.slice(0, 3).join('. ').trim();
  return snippet ? snippet + '.' : 'No short text';
}

/**
 * Extract the full text from item and remove HTML tags for a cleaner look.
 */
function getFullText(item) {
  let html = item['content:encoded'] || item.content || item.contentSnippet || '';
  // Remove HTML tags
  html = html.replace(/<[^>]+>/g, '').trim();
  return html || 'No full text available';
}

/**
 * If a feed is malformed, fetch raw text & sanitize before parsing.
 */
async function fetchAndSanitizeRss(url) {
  const response = await fetch(url);
  let xml = await response.text();
  // Replace or remove invalid entities
  xml = xml.replace(/&(\w+)\s/g, '&$1;');
  return parser.parseString(xml);
}

/**
 * Split text into 2000-char chunks to avoid Notion's limit.
 */
function chunkBy2000(str) {
  const chunks = [];
  let start = 0;
  while (start < str.length) {
    chunks.push(str.slice(start, start + 2000));
    start += 2000;
  }
  return chunks;
}

async function importFeeds() {
  // Skip items older than 24 hours
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  for (const feed of feeds) {
    console.log(`\n=== Fetching ${feed.name} ===`);
    let parsedFeed;

    try {
      // If you suspect a feed is malformed, use fetchAndSanitizeRss
      if (feed.name === 'Re:Russia') {
        parsedFeed = await fetchAndSanitizeRss(feed.url);
      } else {
        parsedFeed = await parser.parseURL(feed.url);
      }
    } catch (err) {
      console.error(`Error fetching/parsing ${feed.name}:`, err);
      continue;
    }

    for (const item of parsedFeed.items || []) {
      try {
        // 1) Convert date
        const published = convertDatePlus8Hours(item.pubDate);
        if (!published) continue;
        if (published.getTime() < oneDayAgo) {
          console.log(`Skipping old item: ${item.title}`);
          continue;
        }

        // 2) Build short + full text
        const shortText = getShortVersion(item.contentSnippet || item.content);
        const fullText = getFullText(item);

        // 3) Check duplicates by (Title OR Link) + Source
        // so you don't get repeated headlines even if links differ
        const existing = await notion.databases.query({
          database_id: databaseId,
          filter: {
            and: [
              // Must match source
              {
                property: 'Source',
                rich_text: { equals: feed.name },
              },
              // AND must match EITHER same title OR same link
              {
                or: [
                  {
                    property: 'Headline', 
                    title: { equals: item.title || '' },
                  },
                  {
                    property: 'URL',
                    url: { equals: item.link || '' },
                  },
                ],
              },
            ],
          },
        });

        if (existing.results.length > 0) {
          console.log(`Skipping duplicate: ${feed.name} – ${item.title}`);
          continue;
        }

        // 4) Create the page in Notion
        const page = await notion.pages.create({
          parent: { database_id: databaseId },
          properties: {
            Date: {
              date: { start: published.toISOString() },
            },
            Headline: {
              title: [
                {
                  type: 'text',
                  text: { content: item.title || 'Untitled' },
                },
              ],
            },
            Short: {
              rich_text: [
                {
                  type: 'text',
                  text: { content: shortText },
                },
              ],
            },
            // Keep "Long" minimal
            Long: {
              rich_text: [
                {
                  type: 'text',
                  text: { content: '[Full text in blocks below]' },
                },
              ],
            },
            Source: {
              rich_text: [
                {
                  type: 'text',
                  text: { content: feed.name },
                },
              ],
            },
            URL: {
              url: item.link || '',
            },
          },
        });

        // 5) Append multiple blocks for the full text
        const blocks = chunkBy2000(fullText).map((textChunk) => ({
          object: 'block',
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: { content: textChunk },
              },
            ],
          },
        }));
        if (blocks.length > 0) {
          await notion.blocks.children.append({
            block_id: page.id,
            children: blocks,
          });
        }

        console.log(`Added to Notion: [${feed.name}] ${item.title}`);
      } catch (createErr) {
        console.error(`Error creating page for ${feed.name}:`, createErr);
      }
    }
  }

  console.log('\nAll done importing!');
}

// Run the main function
importFeeds();
