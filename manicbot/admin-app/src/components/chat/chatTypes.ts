/**
 * Shared types for the web chat widget — client↔Worker contract.
 *
 * Mirror of the JSON shape emitted by src/channels/web.js `_buildPublicMessage`.
 */

export interface ChatBrandPalette {
  primary?: string;
  bg?: string;
  text?: string;
}

export interface ChatSalon {
  slug: string;
  /** Public-facing name (display_name || name) */
  name: string;
  /** Registered legal name — used for footer / micro-hints */
  legalName: string;
  logo: string | null;
  coverPhoto: string | null;
  brandPalette: ChatBrandPalette | null;
  description: string | null;
  city: string | null;
}

export interface ChatButton {
  text: string;
  callback_data: string | null;
  url: string | null;
}

export interface ChatMessageFromBot {
  role: "bot";
  id: string;
  ts: number;
  text: string;
  parseMode?: "HTML" | "MarkdownV2" | "plain";
  buttons: ChatButton[][] | null;
  photo: string | null;
  /** Full image set for the catalog swipe carousel (web only). */
  photos?: string[] | null;
  editMessageId: string | null;
}

export interface ChatMessageFromUser {
  role: "user";
  id: string;
  ts: number;
  text: string;
}

export type ChatMessage = ChatMessageFromBot | ChatMessageFromUser;
