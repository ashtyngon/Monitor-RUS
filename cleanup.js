// cleanup.js — Finds and archives duplicate pages in Notion
require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;
const delay = (ms) => new Promise(r => setTimeout(r, ms));

function normalizeTitle(raw = '') {
  return raw.trim().replace(/[«»“”"]/g, '').replace(/\s+/g, ' ').toLowerCase();
}

async function fetchAllPages() {
  const allPages = [];
  let cursor = undefined;
  console.log('Fetching all pages from database...');
  while (true) {
    const { results, next_cursor } = await notion.databases.query({
      database_id: databaseId,
      page_size: 100,
      start_cursor: cursor,
    });
    allPages.push(...results);
    if (!next_cursor) break;
    cursor = next_cursor;
  }
  console.log(`Found a total of ${allPages.length} pages.`);
  return allPages;
}

async function archivePage(pageId) {
  await notion.pages.update({ page_id: pageId, archived: true });
}

(async function runCleanup() {
  const pages = await fetchAllPages();
  const groups = new Map();

  // Group pages by normalized title
  for (const page of pages) {
    const titleProp = page.properties?.Headline?.title;
    const title = titleProp?.[0]?.plain_text || '';
    const normalized = normalizeTitle(title);
    
    if (normalized) {
      if (!groups.has(normalized)) groups.set(normalized, []);
      groups.get(normalized).push({ id: page.id, title: title });
    }
  }

  let archivedCount = 0;
  for (const [title, items] of groups.entries()) {
    if (items.length > 1) {
      console.log(`Found ${items.length} items for title: "${items[0].title}"`);
      const toArchive = items.slice(1); // Keep the first one, archive the rest
      for (const item of toArchive) {
        try {
          await archivePage(item.id);
          console.log(`  > Archived duplicate page ID: ${item.id}`);
          archivedCount++;
          await delay(200);
        } catch (e) {
          console.error(`  > FAILED to archive ${item.id}: ${e.message}`);
        }
      }
    }
  }

  console.log(`\nCleanup complete. Archived ${archivedCount} duplicate pages.`);
})().catch(err => {
  console.error('A fatal error occurred during cleanup:', err);
  process.exit(1);
});
