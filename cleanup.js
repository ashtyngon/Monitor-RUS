name: Notion Duplicate Cleanup (Last 3 Months)

on:
  workflow_dispatch: {}
  schedule:
    - cron: '0 */4 * * *'   # каждые 4 часа (UTC)

jobs:
  run-cleanup-script:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - name: Check out code
        uses: actions/checkout@v4

      - name: Use Node LTS
        uses: actions/setup-node@v4
        with:
          node-version: 'lts/*'

      - name: Install dependencies
        run: npm ci || npm i

      - name: Run the cleanup script
        env:
          NOTION_API_KEY: ${{ secrets.NOTION_API_KEY }}
          NOTION_DATABASE_ID: ${{ secrets.NOTION_DATABASE_ID }}
        run: node cleanup.js
