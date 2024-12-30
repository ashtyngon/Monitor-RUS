require('dotenv').config();
const { Client } = require('@notionhq/client');
const Parser = require('rss-parser');
const fetch = require('node-fetch'); // If you're on Node <18, for fetch support

// Initialize Notion + RSS parser
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const parser = new Parser();

// Grab the Notion database ID from .env
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
 * Convert the pubDate to Moscow time (UTC+3).
 */
function toMoscowTime(dateString) {
  if (!dateString) return null;
  const originalDate = new Date(dateString);
  if (isNaN(originalDate)) return null;

  // Convert to UTC, then add 3 hours
  const utcTime =
    originalDate.getTime() + originalDate.getTimezoneOffset() * 60_000;
  return new Date(utcTime + 3 * 60 * 60_000);
}

/**
 * Get a short 2–3 sentence snippet.
 */
function getShortVersion(text) {
  if (!text) return 'No short text';
  const sentences = text.split('.').filter(Boolean);
  const snippet = sentences.slice(0, 3).join('. ').trim();
  return snippet ? snippet + '.' : 'No short text';
}

/**
 * Get the full text, if available.
 */
function getFullText(item) {
  // If there's a content:encoded field, use that first.
  const encoded = item['content:encoded'];
  if (encoded) {
    return encoded; // might be HTML
  }
  // Otherwise fallback to content or snippet.
  return item.content || item.contentSnippet || 'No full text available';
}

/**
 * Fetch the RSS feed as raw XML, fix or remove problematic entities, then
 * pass the string to rss-parser’s parseString().
 */
async function fetchAndSanitizeRss(url) {
  const response = await fetch(url);
  let xml = await response.text();

  // Example: replace or remove invalid entities. 
  // If you know the exact bad entity (e.g., `&nbsp` missing a semicolon),
  // you can specifically target that. This is a naive catch-all approach.
  xml = xml.replace(/&(\w+)\s/g, '&$1;');

  // Return the feed *as a string*, to be parsed by parser.parseString().
  return xml;
}

/**
 * Main function that loops through feeds and inserts into Notion.
 * Wrap each feed in try/catch so one bad feed doesn’t kill the entire script.
 */
async function importFeeds() {
  for (const feed of feeds) {
    console.log(`\n=== Fetching ${feed.name} ===`);

    let parsedFeed; // will hold the final parsed feed items

    try {
      // If you suspect a feed is malformed (like Re:Russia),
      // you can do the sanitize step for that specific feed:
      if (feed.name === 'Re:Russia') {
        const rawXml = await fetchAndSanitizeRss(feed.url);
        parsedFeed = await parser.parseString(rawXml);
      } else {
        // For normal feeds with no issues:
        parsedFeed = await parser.parseURL(feed.url);
      }
    } catch (err) {
      console.error(`Error fetching or parsing ${feed.name}:`, err);
      // Move on to the next feed instead of stopping everything
      continue;
    }

    // If we got here, parsedFeed should be okay. Now loop the items.
    for (const item of parsedFeed.items || []) {
      try {
        const published = toMoscowTime(item.pubDate);
        const shortText = getShortVersion(item.contentSnippet || item.content);
        const longText = getFullText(item);

        // (Optional) Avoid duplicates based on URL:
        /*
        const existing = await notion.databases.query({
          database_id: databaseId,
          filter: {
            property: 'URL',
            url: { equals: item.link },
          },
        });
        if (existing.results.length > 0) {
          console.log(`Skipping duplicate: ${item.title}`);
          continue;
        }
        */

        // Create row in your inline database
        await notion.pages.create({
          parent: { database_id: databaseId },
          properties: {
            Date: {
              date: published ? { start: published.toISOString() } : null,
            },
            Headline: {
              title: [
                {
                  type: 'text',
                  text: { content: item.title ?? 'Untitled' },
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

// Run the script
importFeeds();
