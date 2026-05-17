#!/usr/bin/env node
/**
 * Generate a fresh P-256 keypair for VAPID (Web Push) and print the
 * three values the platform needs:
 *
 *   VAPID_PUBLIC_KEY   — set on Pages (Next.js env) and on the Worker
 *   VAPID_PRIVATE_KEY  — Worker secret ONLY (never expose to the browser)
 *   VAPID_SUBJECT      — mailto: URL the push services use as contact
 *
 * Usage:
 *   node manicbot/scripts/generate-vapid-keys.mjs [--subject mailto:ops@example.com]
 */

import { generateKeyPairSync } from "node:crypto";

function b64u(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const args = process.argv.slice(2);
let subject = "mailto:ops@manicbot.com";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--subject" && args[i + 1]) subject = args[i + 1];
}

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });

const jwkPub = publicKey.export({ format: "jwk" });
const x = Buffer.from(jwkPub.x, "base64");
const y = Buffer.from(jwkPub.y, "base64");
const pubRaw = Buffer.concat([Buffer.from([0x04]), x, y]);

const jwkPriv = privateKey.export({ format: "jwk" });
const d = Buffer.from(jwkPriv.d, "base64");

const VAPID_PUBLIC_KEY = b64u(pubRaw);
const VAPID_PRIVATE_KEY = b64u(d);

console.log("\n# Web Push (VAPID) keys — generated", new Date().toISOString());
console.log("# Save these to Pages env vars + Worker secrets. The private key");
console.log("# must NEVER leave the Worker.\n");
console.log(`VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}`);
console.log(`VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY}`);
console.log(`VAPID_SUBJECT=${subject}`);
console.log("\n# Wrangler commands:");
console.log(`#   echo '${VAPID_PUBLIC_KEY}'  | npx wrangler secret put VAPID_PUBLIC_KEY`);
console.log(`#   echo '${VAPID_PRIVATE_KEY}' | npx wrangler secret put VAPID_PRIVATE_KEY`);
console.log(`#   echo '${subject}'           | npx wrangler secret put VAPID_SUBJECT\n`);
