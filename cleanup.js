// cleanup.js
require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function stripPunct(s) {
  return s
    .toLowerCase()
    .replace(/[“”«»„"]/g, '"')
    .replace(/[’‘']/g, "'")
    .replace(/[–—−]/g, "-")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normTitleKey(title, words = 12) {
  if (!title) return null;
  const clean = stripPunct(title);
  const key = clean.split(" ").slice(0, words).join(" ");
  return key || null;
}

function unwrapGoogleNews(link) {
  try {
    const u = new URL(link);
    if (!u.hostname.endsWith("news.google.com")) return link;
    const urlParam = u.searchParams.get("url");
    if (urlParam) {
      try { return new URL(urlParam).toString(); } catch { return urlParam; }
    }
    return link;
  } catch { return link; }
}

function normUrl(link) {
  if (!link) return null;
  try {
    const unwrapped = unwrapGoogleNews(link);
    const u = new URL(unwrapped);
    u.hash = "";
    const drop = new Set(["utm_source","utm_medium","utm_campaign","utm_term","utm_content","oc","cid","si","fbclid","gclid","igsh"]);
    [...u.searchParams.keys()].forEach((k) => { if (drop.has(k.toLowerCase())) u.searchParams.delete(k); });
    let path = u.pathname.replace(/\/+$/, "");
    if (path === "") path = "/";
    u.pathname = path;
    u.username = "";
    u.password = "";
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    return u.toString();
  } catch {
    return link.trim().toLowerCase();
  }
}

async function getRecentPages() {
  const pages = [];
  let hasMore = true;
  let nextCursor = undefined;

  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  console.log(`Fetching pages created on/after ${threeMonthsAgo.toISOString()} ...`);
  while (hasMore) {
    const resp = await notion.databases.query({
      database_id: databaseId,
      start_cursor: nextCursor,
      filter: { property: 'Date', date: { on_or_after: threeMonthsAgo.toISOString() } },
      page_size: 100,
    });
    pages.push(...resp.results);
    hasMore = resp.has_more;
    nextCursor = resp.next_cursor;
    console.log(`Fetched ${pages.length} pages so far...`);
    await delay(150);
  }
  console.log(`Total pages fetched: ${pages.length}`);
  return pages;
}

function readPropText(page, propName) {
  const p = page.properties?.[propName];
  if (!p) return '';
  if (p.type === 'title')     return (p.title?.map(t => t.plain_text).join('') || '').trim();
  if (p.type === 'rich_text') return (p.rich_text?.map(t => t.plain_text).join('') || '').trim();
  if (p.type === 'url')       return (p.url || '').trim();
  if (p.type === 'date')      return p.date?.start || '';
  return '';
}

async function findAndArchiveDuplicates() {
  const pages = await getRecentPages();

  const byTitleKey = new Map();

  for (const page of pages) {
    const title = readPropText(page, 'Headline');
    const rawUrl = readPropText(page, 'URL');
    const created = page.created_time;

    const titleKey = normTitleKey(title);
    const urlKey = normUrl(rawUrl);

    if (!titleKey && !urlKey) continue;
    const key = titleKey || urlKey;

    if (!byTitleKey.has(key)) byTitleKey.set(key, []);
    byTitleKey.get(key).push({
      id: page.id,
      created_time: created,
      title,
      urlKey,
      rawUrl,
    });
  }

  console.log(`Built ${byTitleKey.size} title-keys.`);

  let archived = 0;

  for (const [key, group] of byTitleKey.entries()) {
    if (group.length <= 1) continue;

    const allItems = [...group];
    allItems.sort((a, b) => new Date(a.created_time) - new Date(b.created_time));
    const toArchive = allItems.slice(1);

    console.log(`DUPE (${allItems.length}): "${allItems[0].title}"`);
    for (const p of toArchive) {
      try {
        await notion.pages.update({ page_id: p.id, archived: true });
        archived++;
        console.log(`  archived: ${p.id}  [url=${p.rawUrl || '∅'}]`);
        await delay(350);
      } catch (e) {
        console.error(`  FAIL archive ${p.id}: ${e.message}`);
      }
    }
  }

  console.log(`\nCleanup complete. Total duplicates archived: ${archived}`);
}

findAndArchiveDuplicates().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
