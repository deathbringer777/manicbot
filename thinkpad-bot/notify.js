#!/usr/bin/env node
const path = require("path");

try {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
} catch {}

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID || process.env.ALLOWED_USER_ID;

if (!TOKEN) {
  console.error("notify: TELEGRAM_TOKEN not set in .env");
  process.exit(1);
}
if (!CHAT_ID) {
  console.error("notify: CHAT_ID / ALLOWED_USER_ID not set in .env");
  process.exit(1);
}

const text = process.argv.slice(2).join(" ");
if (!text) process.exit(0);

fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chat_id: parseInt(CHAT_ID, 10), text }),
}).then(r => r.json()).then(d => {
  if (!d.ok) process.stderr.write("Notify failed: " + d.description + "\n");
}).catch(e => process.stderr.write("Notify error: " + e.message + "\n"));
