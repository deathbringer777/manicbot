/**
 * Public web chat: the empty-bubble guard.
 *
 * The Worker emits a zero-width-space message with remove_keyboard to clear the
 * Telegram reply keyboard; on web that must NOT render as an empty grey bubble.
 * `isRenderableMessage` is the filter applied in appendBotMessages.
 */
import { describe, it, expect } from "vitest";
import { isRenderableMessage } from "~/app/(public)/salon/[slug]/chat/ChatClient";
import type { ChatMessage } from "~/components/chat/chatTypes";

function msg(over: Partial<ChatMessage>): ChatMessage {
  return {
    id: "m",
    role: "bot",
    text: "",
    ts: 1,
    buttons: null,
    photo: null,
    editMessageId: null,
    ...over,
  } as ChatMessage;
}

describe("isRenderableMessage", () => {
  it("drops a zero-width-space-only message", () => {
    expect(isRenderableMessage(msg({ text: "​" }))).toBe(false);
  });

  it("drops an empty / whitespace-only message", () => {
    expect(isRenderableMessage(msg({ text: "" }))).toBe(false);
    expect(isRenderableMessage(msg({ text: "   \n\t" }))).toBe(false);
  });

  it("keeps a normal text message", () => {
    expect(isRenderableMessage(msg({ text: "Witamy w salonie!" }))).toBe(true);
  });

  it("keeps a whitespace-empty message that carries buttons", () => {
    expect(
      isRenderableMessage(
        msg({ text: "​", buttons: [[{ text: "Book", callback_data: "book", url: null }]] }),
      ),
    ).toBe(true);
  });

  it("keeps a photo-only message with empty text", () => {
    expect(isRenderableMessage(msg({ text: "", photo: "https://cdn/x.webp" }))).toBe(true);
  });

  it("drops a message with an empty buttons array and no text", () => {
    expect(isRenderableMessage(msg({ text: "​", buttons: [] }))).toBe(false);
  });
});
