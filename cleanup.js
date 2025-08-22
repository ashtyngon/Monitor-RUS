require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;

// Задержка, чтобы не превышать лимиты API Notion
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getRecentPages() {
    const pages = [];
    let hasMore = true;
    let nextCursor = undefined;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    console.log(`Fetching pages created after ${thirtyDaysAgo.toISOString()}...`);
    while (hasMore) {
        const response = await notion.databases.query({
            database_id: databaseId,
            start_cursor: nextCursor,
            filter: {
                property: 'Date',
                date: { on_or_after: thirtyDaysAgo.toISOString() },
            },
        });
        pages.push(...response.results);
        hasMore = response.has_more;
        nextCursor = response.next_cursor;
        console.log(`Fetched ${pages.length} pages...`);
    }
    console.log(`Total recent pages fetched: ${pages.length}`);
    return pages;
}

function createSimilarityKey(page) {
    const headlineProp = page.properties.Headline;
    const sourceProp = page.properties.Source;

    if (headlineProp && headlineProp.title && headlineProp.title.length > 0 &&
        sourceProp && sourceProp.rich_text && sourceProp.rich_text.length > 0) {
        
        const headline = headlineProp.title[0].plain_text.trim();
        const source = sourceProp.rich_text[0].plain_text.trim();

        // --- ИЗМЕНЕНО ЗДЕСЬ: Ключ = Источник + Первые 5 слов из заголовка ---
        const key = source + ' | ' + headline.split(' ').slice(0, 5).join(' ');
        return key;
    }
    return null;
}

async function findAndArchiveDuplicates() {
    const recentPages = await getRecentPages();
    const pagesByKey = new Map();

    for (const page of recentPages) {
        const key = createSimilarityKey(page);
        if (key) {
            if (!pagesByKey.has(key)) {
                pagesByKey.set(key, []);
            }
            pagesByKey.get(key).push({
                id: page.id,
                created_time: page.created_time
            });
        }
    }

    console.log(`Found ${pagesByKey.size} unique article keys in the last 30 days.`);

    let duplicatesArchived = 0;
    for (const [key, pages] of pagesByKey.entries()) {
        if (pages.length > 1) {
            console.log(`Found ${pages.length} items for key: "${key}"`);
            
            pages.sort((a, b) => new Date(a.created_time) - new Date(b.created_time));
            
            const pagesToArchive = pages.slice(1);

            for (const page of pagesToArchive) {
                try {
                    await notion.pages.update({
                        page_id: page.id,
                        archived: true,
                    });
                    duplicatesArchived++;
                    console.log(`  Archived page ID: ${page.id}`);
                    await delay(350);
                } catch (error) {
                    console.error(`  Failed to archive page ID ${page.id}: ${error.message}`);
                }
            }
        }
    }

    console.log(`\nCleanup complete. Total duplicates archived: ${duplicatesArchived}`);
}

findAndArchiveDuplicates().catch(err => {
    console.error('A fatal error occurred:', err);
    process.exit(1);
});
