require('dotenv').config();
const { Client } = require('@notionhq/client');
const Parser = require('rss-parser');
const sanitizeHtml = require('sanitize-html');

// Initialize Notion + RSS parser
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const parser = new Parser({
  customFields: {
    item: ['content:encoded']
  }
});

// Deduplicated feeds (using Set to prevent duplicate URLs)
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
  { name: 'Агентство', url: 'https://rss.app/feeds/YrL7Ml9AxJqQXZU8.xml' },
  { name: 'The Bell', url: 'https://thebell.io/feed' }
].filter((feed, index, self) => 
  index === self.findIndex((t) => t.url === feed.url)
);

const databaseId = process.env.NOTION_DATABASE_ID;

// Fixed time conversion to Moscow time (UTC+3)
function toMoscowTime(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (isNaN(date)) return null;
  
  // Create a date in Moscow time zone
  const moscowDate = new Date(date.toLocaleString('en-US', {
    timeZone: 'Europe/Moscow'
  }));
  
  return moscowDate;
}

// Clean HTML and get short version
function getShortVersion(text) {
  if (!text) return 'No short text';
  
  // Clean HTML tags and normalize spaces
  const cleanText = sanitizeHtml(text, {
    allowedTags: [],
    allowedAttributes: {}
  }).replace(/\s+/g, ' ').trim();
  
  const sentences = cleanText.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const snippet = sentences.slice(0, 3).join('. ').trim();
  return snippet ? snippet + '.' : 'No short text';
}

// Clean and format full text
function getFullText(item) {
  let text = item['content:encoded'] || item.content || item.contentSnippet || '';
  
  // Clean HTML but keep paragraph structure
  return sanitizeHtml(text, {
    allowedTags: ['p', 'br', 'b', 'i', 'strong', 'em'],
    allowedAttributes: {},
    transformTags: {
      'div': 'p'
    }
  }).trim() || 'No full text available';
}

// Fetch and sanitize RSS
async function fetchAndSanitizeRss(url) {
  const response = await fetch(url);
  let xml = await response.text();
  
  // Fix common RSS/XML issues
  xml = xml.replace(/&(?!(?:amp|lt|gt|quot|apos);)/g, '&amp;')
           .replace(/&(\w+)\s/g, '&$1;');
  
  return parser.parseString(xml);
}

// Split text into Notion-compatible chunks
function chunkText(str) {
  const chunks = [];
  let start = 0;
  const maxLength = 1990; // Leave some buffer for Notion's 2000 char limit
  
  while (start < str.length) {
    chunks.push(str.slice(start, start + maxLength));
    start += maxLength;
  }
  
  return chunks;
}

// Generate unique key for deduplication
function getItemKey(item, feedName) {
  return `${feedName}:${item.link}:${item.title}`;
}

async function importFeeds() {
  const processedItems = new Set(); // Track items we've seen
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  for (const feed of feeds) {
    console.log(`\n=== Fetching ${feed.name} ===`);
    let parsedFeed;

    try {
      parsedFeed = await fetchAndSanitizeRss(feed.url);
    } catch (err) {
      console.error(`Error fetching/parsing ${feed.name}:`, err);
      continue;
    }

    for (const item of parsedFeed.items || []) {
      try {
        const itemKey = getItemKey(item, feed.name);
        if (processedItems.has(itemKey)) {
          console.log(`Skipping duplicate: ${item.title}`);
          continue;
        }
        processedItems.add(itemKey);

        const published = toMoscowTime(item.pubDate);
        if (!published || published.getTime() < oneDayAgo) {
          console.log(`Skipping old/invalid date item: ${item.title}`);
          continue;
        }

        // Check for existing entry in Notion
        const existing = await notion.databases.query({
          database_id: databaseId,
          filter: {
            and: [
              { property: 'URL', url: { equals: item.link || '' } },
              { property: 'Source', rich_text: { equals: feed.name } }
            ]
          }
        });

        if (existing.results.length > 0) {
          console.log(`Skipping existing: ${item.title}`);
          continue;
        }

        const shortText = getShortVersion(item.contentSnippet || item.content);
        const fullText = getFullText(item);

        // Create the page
        const page = await notion.pages.create({
          parent: { database_id: databaseId },
          properties: {
            Date: {
              date: { start: published.toISOString() }
            },
            Headline: {
              title: [{ type: 'text', text: { content: item.title || 'Untitled' } }]
            },
            Short: {
              rich_text: [{ type: 'text', text: { content: shortText } }]
            },
            Long: {
              rich_text: [{ type: 'text', text: { content: '[Full text below]' } }]
            },
            Source: {
              rich_text: [{ type: 'text', text: { content: feed.name } }]
            },
            URL: {
              url: item.link || ''
            }
          }
        });

        // Append full text as blocks
        const blocks = chunkText(fullText).map(chunk => ({
          object: 'block',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: chunk } }]
          }
        }));

        if (blocks.length > 0) {
          await notion.blocks.children.append({
            block_id: page.id,
            children: blocks
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

importFeeds();
