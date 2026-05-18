/**
 * Parity check between the admin-app and Worker copies of the channel
 * error_type catalog. Both files exist because the admin-app cannot import
 * Worker source directly (different runtime + bundler), but the slug strings
 * MUST stay in lockstep — the admin-app queries `error_events.error_type`
 * by the slug the Worker writes.
 *
 * If a slug is added or renamed, this test fails loudly until both copies
 * are updated.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CHANNEL_ERROR_TYPE,
  IG_ALL_ERROR_TYPES,
  IG_BROKEN_ERROR_TYPES,
  IG_DEGRADED_ERROR_TYPES,
} from "~/server/api/channelErrorTypes";

function readWorkerCatalog(): {
  CHANNEL_ERROR_TYPE: Record<string, string>;
  IG_BROKEN_ERROR_TYPES: string[];
  IG_DEGRADED_ERROR_TYPES: string[];
} {
  // admin-app sits inside manicbot/ → walk up to manicbot/src/channels/.
  const path = resolve(__dirname, "../../../src/channels/error-types.js");
  const src = readFileSync(path, "utf-8");

  // Tiny custom parser — the Worker file is JS-with-Object.freeze, not JSON.
  // Pull out the key:value pairs inside CHANNEL_ERROR_TYPE.
  const objMatch = src.match(/CHANNEL_ERROR_TYPE\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/);
  if (!objMatch) throw new Error("Worker CHANNEL_ERROR_TYPE not found");
  const pairs: Record<string, string> = {};
  const pairRe = /([A-Z_]+):\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(objMatch[1]!))) pairs[m[1]!] = m[2]!;

  function extractArr(label: string): string[] {
    const re = new RegExp(`${label}\\s*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`);
    const arr = src.match(re);
    if (!arr) throw new Error(`Worker ${label} not found`);
    return Array.from(arr[1]!.matchAll(/CHANNEL_ERROR_TYPE\.([A-Z_]+)/g)).map(m2 => pairs[m2[1]!]!);
  }

  return {
    CHANNEL_ERROR_TYPE: pairs,
    IG_BROKEN_ERROR_TYPES: extractArr("IG_BROKEN_ERROR_TYPES"),
    IG_DEGRADED_ERROR_TYPES: extractArr("IG_DEGRADED_ERROR_TYPES"),
  };
}

describe("channel error_type catalog — parity admin-app ↔ worker", () => {
  const worker = readWorkerCatalog();

  it("CHANNEL_ERROR_TYPE keys match between admin-app and worker", () => {
    expect(Object.keys(CHANNEL_ERROR_TYPE).sort()).toEqual(
      Object.keys(worker.CHANNEL_ERROR_TYPE).sort(),
    );
  });

  it("each slug value is identical", () => {
    for (const k of Object.keys(CHANNEL_ERROR_TYPE)) {
      const adminSlug = (CHANNEL_ERROR_TYPE as Record<string, string>)[k];
      const workerSlug = worker.CHANNEL_ERROR_TYPE[k];
      expect(adminSlug).toBe(workerSlug);
    }
  });

  it("IG_BROKEN_ERROR_TYPES is identical (order-sensitive — both feed UI matchers)", () => {
    expect([...IG_BROKEN_ERROR_TYPES]).toEqual(worker.IG_BROKEN_ERROR_TYPES);
  });

  it("IG_DEGRADED_ERROR_TYPES is identical", () => {
    expect([...IG_DEGRADED_ERROR_TYPES]).toEqual(worker.IG_DEGRADED_ERROR_TYPES);
  });

  it("IG_ALL_ERROR_TYPES is the union of broken + degraded", () => {
    expect([...IG_ALL_ERROR_TYPES]).toEqual([
      ...IG_BROKEN_ERROR_TYPES,
      ...IG_DEGRADED_ERROR_TYPES,
    ]);
  });

  it("every slug has a matching i18n key for ru/ua/en/pl", async () => {
    // i18n module only exposes named exports; we only need `t` here.
    const { t } = await import("~/lib/i18n");
    const langs = ["ru", "ua", "en", "pl"] as const;
    for (const slug of Object.values(CHANNEL_ERROR_TYPE)) {
      const suffix = slug.startsWith("channel.ig.")
        ? slug.slice("channel.ig.".length)
        : slug === "channel.meta.signature_mismatch"
        ? "signature_mismatch"
        : "unknown";
      const key = `channels.ig.errorType.${suffix}` as const;
      for (const lang of langs) {
        const tr = t(key as Parameters<typeof t>[0], lang);
        // Translation must NOT fall through to the key (would mean missing).
        expect(tr).not.toBe(key);
        expect(tr.length).toBeGreaterThan(5);
      }
    }
  });
});
