import { createAuthClient } from "better-auth/react";

/**
 * Same-origin client: requests use the relative `/api/auth` path, which Vite
 * proxies to the API in development and a reverse proxy serves in production,
 * so the session cookie always lives on the app origin.
 */
export const authClient = createAuthClient();
