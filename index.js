require('dotenv').config();
const { Client } = require('@notionhq/client');
const Parser = require('rss-parser');

// Initialize Notion + RSS parser
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const parser = new Parser();

// Your inline database ID from .env
const databaseId = process.env.NOTION_DATABASE_ID;

// Feeds
const feeds = [
  { name: 'Медуза', url: 'https://meduza.io/rss/all' },
  { name: 'Инсайдер', url: 'https://theins.ru/feed' },
  { name: 'Медиазона', url: 'https://zona.media/rss' },
  { name: 'Re:Russia', url: 'https://re-russia.net/feed/' },
  { name: 'Холод', url: 'https://holod.media/feed' },
  { name: 'Русская служба Би-би-си', url: 'http://feeds.bbci.co.uk/russian/rss.xml' },
  { name: 'Верстка', url: 'https://verstka.media/feed' },
  { name: 'Новая газета', url: 'https://novayagazeta.ru/rss' },
  { name: 'Новая газета. Европа', url: 'https://novayagazeta.eu/rss' },
  { name: 'The Bell', url: 'https://thebell.io/feed' },
];

/**
 * Convert pubDate to Moscow time (UTC+3).
 */
function toMoscowTime(dateString) {
  if (!dateString) return null;
  const originalDate = new Date(dateString);
  if (isNaN(originalDate)) return null;

  // Convert to UTC, then add 3 hours
  const utcTime = originalDate.getTime() + originalDate.getTimezoneOffset() * 60000;
  return new Date(utcTime + 3 * 3600000);
}

/**
 * Return the first 2–3 sentences as a short snippet.
 */
function getShortVersion(text) {
  if (!text) return 'No short text';
  const sentences = text.split('.').filter(Boolean);
  const snippet = sentences.slice(0, 3).join('. ').trim();
  return snippet ? snippet + '.' : 'No short text';
}

/**
 * Return the "long" text (content:encoded if it exists, else content/snippet).
 */
function getFullText(item) {
  const encoded = item['content:encoded'];
  if (encoded) {
    return encoded; // might be HTML
  }
  return item.content || item.contentSnippet || 'No full text available';
}

/**
 * Fetch & sanitize RSS (only needed for problematic feeds, but let's do it for Re:Russia).
 * Otherwise, just use parser.parseURL(feed.url).
 */
async function fetchAndSanitizeRss(url) {
  // Using built-in fetch in Node 18+
  const response = await fetch(url);
  let xml = await response.text();

  // Example fix: replace or remove invalid entities
  xml = xml.replace(/&(\w+)\s/g, '&$1;');

  // Parse with rss-parser
  return parser.parseString(xml);
}

async function importFeeds() {
  // Anything older than 24 hours is skipped
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  for (const feed of feeds) {
    console.log(`\n=== Fetching ${feed.name} ===`);
    let parsedFeed;

    try {
      if (feed.name === 'Re:Russia') {
        // sanitize if you suspect invalid XML
        parsedFeed = await fetchAndSanitizeRss(feed.url);
      } else {
        // normal parse
        parsedFeed = await parser.parseURL(feed.url);
      }
    } catch (err) {
      console.error(`Error fetching/parsing ${feed.name}:`, err);
      continue;
    }

    for (const item of parsedFeed.items || []) {
      try {
        const published = toMoscowTime(item.pubDate);
        if (!published) continue; // no valid date -> skip

        // Skip if older than 24 hours
        if (published.getTime() < oneDayAgo) {
          console.log(`Skipping old item: ${item.title}`);
          continue;
        }

        // Build short and long versions
        const shortText = getShortVersion(item.contentSnippet || item.content);
        const longText = getFullText(item);

        // Check for duplicates by URL + Source
        // (So the same link from the same feed won't be inserted twice.)
        const existing = await notion.databases.query({
          database_id: databaseId,
          filter: {
            and: [
              { 
                property: 'URL', 
                url: { equals: item.link || '' } 
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

        // Create row in Notion
        await notion.pages.create({
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
            Long: {
              rich_text: [
                {
                  type: 'text',
                  text: { content: longText },
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

        console.log(`Added to Notion: [${feed.name}] ${item.title}`);
      } catch (createErr) {
        console.error(`Error creating page for ${feed.name}:`, createErr);
      }
    }
  }

  console.log('\nAll done importing!');
}

// Run
importFeeds();
