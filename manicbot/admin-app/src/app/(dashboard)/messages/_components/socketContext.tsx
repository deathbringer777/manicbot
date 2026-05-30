"use client";

import { createContext, useContext } from "react";
import type { MessengerSocket } from "~/hooks/useMessengerSocket";

/**
 * Shares the single MessengerHub socket (status / typing / sendTyping) from
 * MessagesClient down to ThreadView, ThreadList, and MessageComposer without
 * prop-drilling. Defaults to a no-op so components rendered without a provider
 * (e.g. the God-Mode panes, which have no per-tenant socket) still work.
 */
const NOOP: MessengerSocket = {
  status: "idle",
  sendTyping: () => {},
  typing: [],
};

const MessengerSocketCtx = createContext<MessengerSocket>(NOOP);

export const MessengerSocketProvider = MessengerSocketCtx.Provider;

export function useMessengerSocketCtx(): MessengerSocket {
  return useContext(MessengerSocketCtx);
}
