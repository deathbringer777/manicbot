/** Minimal next-auth stub for Vitest (avoids importing next/server in Node.js test env). */
export default function NextAuth(_config: unknown) {
  return {
    handlers: { GET: () => null, POST: () => null },
    auth: async () => null,
    signIn: async () => null,
    signOut: async () => null,
  };
}

export const handlers = { GET: () => null, POST: () => null };
export const auth = async () => null;
export const signIn = async () => null;
export const signOut = async () => null;
