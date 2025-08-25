// cleanup.js — One-time script with increased timeout
require('dotenv').config();
const { Client } = require('@notionhq/client');

// 👇 ADDED a 5-minute timeout to the client configuration
const notion = new Client({
  auth: process.env.NOTION_API_KEY,
  timeout_ms: 300000, // 5 minutes
});

const databaseId = process.env.NOTION_DATABASE_ID;
const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function cleanupDuplicates() {
  console.log('Fetching all pages from the database. This might take a while...');
  const pagesByUrl = new Map();
  let cursor = undefined;

  // 1. Fetch all pages and group them by URL
  while (true) {
    const { results, next_cursor } = await notion.databases.query({
      database_id: databaseId,
      page_size: 100,
      start_cursor: cursor,
    });

    for (const page of results) {
      const urlProp = page.properties['URL'];
      if (urlProp && urlProp.url) {
        const url = urlProp.url;
        if (!pagesByUrl.has(url)) {
          pagesByUrl.set(url, []);
        }
        pagesByUrl.get(url).push(page.id);
      }
    }

    if (!next_cursor) break;
    cursor = next_cursor;
  }

  console.log(`Found ${pagesByUrl.size} unique URLs across all pages.`);

  // 2. Identify duplicates and archive them
  let duplicatesFound = 0;
  let pagesToDelete = [];
  
  for (const [url, pageIds] of pagesByUrl.entries()) {
    if (pageIds.length > 1) {
      const duplicatesCount = pageIds.length - 1;
      duplicatesFound += duplicatesCount;
      console.log(`Found ${duplicatesCount} duplicate(s) for URL: ${url}`);
      
      const idsToDelete = pageIds.slice(1);
      pagesToDelete.push(...idsToDelete);
    }
  }

  if (pagesToDelete.length === 0) {
    console.log('No duplicates found. Your database is clean! ✨');
    return;
  }

  console.log(`\nReady to delete a total of ${duplicatesFound} duplicate pages.`);

  // 3. Archive the duplicate pages
  for (let i = 0; i < pagesToDelete.length; i++) {
    const pageId = pagesToDelete[i];
    try {
      await notion.pages.update({
        page_id: pageId,
        archived: true,
      });
      console.log(`[${i + 1}/${pagesToDelete.length}] Archived duplicate page: ${pageId}`);
      await delay(200); // Be kind to the Notion API
    } catch (error) {
      console.error(`Failed to archive page ${pageId}:`, error.message);
    }
  }

  console.log('\nCleanup complete!');
}

cleanupDuplicates().catch(err => {
  console.error('An error occurred during cleanup:', err);
  process.exit(1);
});
