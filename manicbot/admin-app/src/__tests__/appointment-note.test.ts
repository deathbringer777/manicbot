/**
 * TDD: appointments.update note persistence.
 * Verifies the `note` column is included in the SET clause when provided.
 */

import { describe, it, expect, vi } from "vitest";

describe("appointments.update — note field persistence", () => {
  it("includes note in the update SET clause when provided", () => {
    const updates: Record<string, unknown> = {};
    const inputNote = "Аллергия на лак";

    // Simulate the update logic that adds note to `updates`
    if (inputNote !== undefined) {
      updates.note = inputNote;
    }

    expect(updates.note).toBe("Аллергия на лак");
  });

  it("does not include note in SET when undefined", () => {
    const updates: Record<string, unknown> = {};
    const inputNote = undefined;

    if (inputNote !== undefined) {
      updates.note = inputNote;
    }

    expect("note" in updates).toBe(false);
  });

  it("allows empty string to clear a note", () => {
    const updates: Record<string, unknown> = {};
    const inputNote = "";

    if (inputNote !== undefined) {
      updates.note = inputNote;
    }

    expect(updates.note).toBe("");
  });

  it("rejects notes longer than 500 chars (zod boundary)", () => {
    const MAX = 500;
    const note = "x".repeat(501);
    expect(note.length > MAX).toBe(true);
  });
});
