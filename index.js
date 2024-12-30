require('dotenv').config();
const { Client } = require('@notionhq/client');
const Parser = require('rss-parser');

// 1) Initialize Notion + RSS parser
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const parser = new Parser();

// 2) Put your feeds here
const feeds = [
  { name: 'Медуза', url: 'https://meduza.io/rss/all' },
  { name: 'Инсайдер', url: 'https://theins.ru/feed' },
  { name: 'Медиазона', url: 'https://zona.media/rss' },
  { name: 'Re:Russia', url: 'https://rss.app/feeds/407wNrMr23sxZy4E.xml' },
  { name: 'Холод', url: 'https://holod.media/feed' },
  { name: 'Русская служба Би-би-си', url: 'http://feeds.bbci.co.uk/russian/rss.xml' },
  { name: 'Верстка', url: 'https://rss.app/feeds/iOGN8vsmRgHrnpf1.xml' },
  { name: 'Новая газета', url: 'https://novayagazeta.ru/rss' },
  { name: 'Новая газета. Европа', url: 'https://rss.app/feeds/pPzIBllexkCT3MqR.xml' },
  { name: 'Новая газета. Европа', url: 'https://rss.app/feeds/vdXv5kXzFa4IWki7.xml' },
  { name: 'Агентство', url: 'https://rss.app/feeds/YrL7Ml9AxJqQXZU8.xml' },
  { name: 'Агентство', url: 'https://rss.app/feeds/MZose7CCrJl0ImQC.xml' },
  { name: 'The Bell', url: 'https://thebell.io/feed' },
];

// 3) Get the Notion database ID from .env
const databaseId = process.env.NOTION_DATABASE_ID;

// 4) Convert pubDate to Moscow time
function toMoscowTime(dateString) {
  if (!dateString) return null;
  const originalDate = new Date(dateString);
  if (isNaN(originalDate)) return null;

  // Convert to UTC, then add 3 hours
  const utcTime = originalDate.getTime() + originalDate.getTimezoneOffset() * 60_000;
  return new Date(utcTime + 3 * 3_600_000);
}

// 5) Short snippet for 2–3 sentences
function getShortVersion(text) {
  if (!text) return 'No short text';
  const sentences = text.split('.').filter(Boolean);
  const snippet = sentences.slice(0, 3).join('. ').trim();
  return snippet ? snippet + '.' : 'No short text';
}

// 6) Return the full text (content:encoded if present)
function getFullText(item) {
  if (item['content:encoded']) return item['content:encoded'];
  return item.content || item.contentSnippet || 'No full text available';
}

// 7) Fetch & sanitize RSS for potentially malformed feeds
async function fetchAndSanitizeRss(url) {
  const response = await fetch(url);
  let xml = await response.text();
  // Replace or remove invalid entities
  xml = xml.replace(/&(\w+)\s/g, '&$1;');
  return parser.parseString(xml);
}

// 8) Chunk a string into <= 2000-char pieces (Notion limit for each text block)
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
  // We skip items older than 24 hours
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  for (const feed of feeds) {
    console.log(`\n=== Fetching ${feed.name} ===`);
    let parsedFeed;

    try {
      // For Re:Russia or if you suspect malformed feed, sanitize. 
      // Or do it for every feed if you prefer.
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
        // Convert date to Moscow time
        const published = toMoscowTime(item.pubDate);
        if (!published) continue; // skip if no valid date

        // Skip if older than 24 hours
        if (published.getTime() < oneDayAgo) {
          console.log(`Skipping old item: ${item.title}`);
          continue;
        }

        // Short + full text
        const shortText = getShortVersion(item.contentSnippet || item.content);
        const fullText = getFullText(item);

        // Check for duplicates (same source + same URL)
        const existing = await notion.databases.query({
          database_id: databaseId,
          filter: {
            and: [
              {
                property: 'URL',
                url: { equals: item.link || '' },
              },
              {
                property: 'Source',
                rich_text: { equals: feed.name },
              },
            ],
          },
        });
        if (existing.results.length > 0) {
          console.log(`Skipping duplicate: ${feed.name} – ${item.title}`);
          continue;
        }

        // 1) Create the page in Notion with main properties
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
            // We keep "Long" short or a placeholder because of the 2000-char limit
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

        // 2) Append multiple blocks for the full text
        const blocks = chunkBy2000(fullText).map(textChunk => ({
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
