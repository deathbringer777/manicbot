import { handlers } from "~/server/auth/auth";

export const runtime = "edge";

export const { GET, POST } = handlers;
