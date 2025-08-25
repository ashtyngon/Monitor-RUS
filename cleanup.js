name: Run Index (Every 30 Minutes)

on:
  schedule:
    - cron: "*/30 * * * *"
  workflow_dispatch: {}

concurrency:
  group: ${{ github.workflow }}
  cancel-in-progress: true

jobs:
  run-index-script:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Use Node LTS
        uses: actions/setup-node@v4
        with:
          node-version: 'lts/*'

      - name: Install dependencies
        run: npm install # <-- CORRECTED LINE

      - name: Run index.js
        env:
          NOTION_API_KEY: ${{ secrets.NOTION_API_KEY }}
          NOTION_DATABASE_ID: ${{ secrets.NOTION_DATABASE_ID }}
        run: node index.js
