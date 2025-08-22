require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getAllPages() {
    const pages = [];
    let hasMore = true;
    let nextCursor = undefined;

    console.log('Fetching all pages from Notion database...');
    while (hasMore) {
        const response = await notion.databases.query({
            database_id: databaseId,
            start_cursor: nextCursor,
        });
        pages.push(...response.results);
        hasMore = response.has_more;
        nextCursor = response.next_cursor;
        console.log(`Fetched ${pages.length} pages...`);
    }
    console.log(`Total pages fetched: ${pages.length}`);
    return pages;
}

async function findAndArchiveDuplicates() {
    const allPages = await getAllPages();
    const pagesByHeadline = new Map();

    for (const page of allPages) {
        const headlineProp = page.properties.Headline;
        if (headlineProp && headlineProp.title && headlineProp.title.length > 0) {
            const headline = headlineProp.title[0].plain_text;
            if (!pagesByHeadline.has(headline)) {
                pagesByHeadline.set(headline, []);
            }
            pagesByHeadline.get(headline).push({
                id: page.id,
                created_time: page.created_time
            });
        }
    }

    console.log(`Found ${pagesByHeadline.size} unique headlines.`);

    let duplicatesArchived = 0;
    for (const [headline, pages] of pagesByHeadline.entries()) {
        if (pages.length > 1) {
            console.log(`Found ${pages.length} items for headline: "${headline}"`);
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
