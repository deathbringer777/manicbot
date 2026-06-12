#!/usr/bin/env node
/**
 * health-report — fetch the current draft counts from the Worker seam and print a
 * one-line status. Read by the tg-bot /drafts command and the hourly health cron.
 * Exit non-zero on a seam error so PM2/cron surfaces an outage.
 */

import { api } from './lib/api.js';

async function main() {
  const res = await api.listDrafts();
  const stamp = new Date().toISOString();
  if (!res.ok) {
    console.error(`[health] ${stamp} seam_error=${res.error}`);
    process.exitCode = 1;
    return;
  }
  const campaigns = res.campaigns?.length ?? 0;
  const templates = res.templates?.length ?? 0;
  console.log(`[health] ${stamp} draft_campaigns=${campaigns} draft_templates=${templates}`);
}

main();
