import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";

/**
 * Same-origin client: requests use the relative `/api/auth` path, which Vite
 * proxies to the API in development and a reverse proxy serves in production,
 * so the session cookie always lives on the app origin.
 *
 * The admin plugin adds `authClient.admin.*` (list/create/ban/… users). Those
 * endpoints are already enabled server-side and gated to the `admin` role.
 */
export const authClient = createAuthClient({
  plugins: [adminClient()],
});
