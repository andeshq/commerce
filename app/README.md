# app

Frontend for the commerce platform: a **React Router data-mode SPA**
(client-only) built with Vite, React 19, Tailwind CSS v4, and
[HeroUI v3](https://heroui.com).

## Commands

```bash
bun install
bun run dev        # Vite dev server (app at http://localhost:5173/_/)
bun run build      # production build -> dist/
bun run preview    # preview the build
bun run typecheck
```

## Stack

- **React Router 8 (data mode)** — `createBrowserRouter` with `loader`s,
  `action`s and `useFetcher`; routes live in `routes/<feature>/<name>.tsx` and
  are wired in `router.tsx`. No framework mode, no SSR: loaders run in the
  browser, so cookie-authenticated `/api/rest` calls work as-is.
- **HeroUI v3** (`@heroui/react` + `@heroui/styles`) — no provider required.
  `RouterProvider` from `react-aria-components` routes HeroUI links through
  React Router (mounted in `routes/root/rootLayout.tsx`).
- **Tailwind CSS v4** via `@tailwindcss/vite`.

`styles/globals.css` must import Tailwind before HeroUI:

```css
@import "tailwindcss";
@import "@heroui/styles";
```

## Structure

```
vite.config.ts        react + tailwind plugins; base /_/, dev proxy to the API
index.html            SPA entry (static loading state, then main.tsx)
main.tsx              createRoot + <RouterProvider>
router.tsx            route tree: loaders, actions, error boundary, 404
routes/
  root/               root layout (auth + link routing), error, 404
  setup/ signIn/
  admin/              admin layout loader = staff gate + store identity
    dashboard/ product/ option/ modifier/ category/ inventory/ team/ settings/
lib/                  pgbase client, schemas, form components, helpers
```

Add a route by creating `routes/<feature>/<name>.tsx` and registering it in
`router.tsx`.

## API access

In dev, `vite.config.ts` proxies `/api` to the API at `http://localhost:8080`,
so requests stay same-origin (no CORS, first-party cookies). In production the
API serves the built `dist/` itself under `/_`, so it's the same origin with no
proxy.
