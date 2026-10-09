# app

Frontend for the commerce platform: a **React Router data-mode SPA**
(client-only) built with Vite, React 19, Tailwind CSS v4, and
[HeroUI v3](https://heroui.com).

## Commands

```bash
bun install
bun run dev        # Vite dev server (default http://localhost:5173)
bun run build      # production build -> dist/
bun run preview    # preview the build
bun run typecheck
```

## Stack

- **React Router 8 (data mode)** — `createBrowserRouter` with `loader`s,
  `action`s and `useFetcher`; routes live in `routes/<feature>/<name>.tsx` and
  are wired in `router.tsx`. No framework mode, no SSR: loaders run in the
  browser, so cookie-authenticated `/rest` calls work as-is.
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
vite.config.ts        react + tailwind plugins; dev proxy to the API
index.html            SPA entry (static loading state, then main.tsx)
main.tsx              createRoot + <RouterProvider>
router.tsx            route tree: loaders, actions, error boundary, 404
routes/
  root/               root layout (auth + link routing), error, 404
  storefront/ setup/ signIn/
  admin/              admin layout loader = staff gate + store identity
    dashboard/ product/ option/ modifier/ category/ inventory/ settings/
lib/                  pgbase client, schemas, form components, helpers
```

Add a route by creating `routes/<feature>/<name>.tsx` and registering it in
`router.tsx`.

## API access

In dev, `vite.config.ts` proxies `/api`, `/rest` and `/media` to the API at
`http://localhost:3000`, so requests stay same-origin (no CORS, first-party
cookies). In production, serve the built `dist/` assets behind a proxy that
forwards those paths to the API.
