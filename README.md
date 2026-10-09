# commerce

Headless commerce: one Bun service that serves a REST API and the merchant admin
UI from a single origin, on Postgres, with Postgres RLS as the only authorization
system.

## Features

- **Catalog** — products, variants, store-scoped options, modifiers, categories
  and media.
- **Inventory** — multiple locations with a stock ledger; adjustments recorded,
  never overwritten.
- **Orders** — carts (guest or signed-in) → checkout → orders, with fulfillment,
  refunds and cancellation. Unpaid orders expire and restock automatically.
- **Payments** — pluggable gateways, chosen per checkout. Wompi (Colombia) ships
  alongside a test provider.
- **Tax** — a store rate with per-variant overrides, inclusive or exclusive
  pricing.
- **Storefront API** — a curated public read surface (product listings,
  categories, full product pages) plus cart and checkout, all over the same REST
  API.
- **Admin UI** — the back office, served from the same origin as the API.

## Stack

Bun · Hono · Kysely · Better Auth (identity) · pgbase (PostgREST-style REST and
`SET LOCAL ROLE`) · Postgres RLS · React Router (data mode) + HeroUI + Tailwind.

Identity lives in an `auth` schema, everything else in `commerce`. pgbase maps a
session to a Postgres role (`web_anon` → `web_customer` → `web_staff` →
`web_admin`) and RLS does the rest — there is no app-side permission check to keep
in sync.

## Getting started

Requires [Bun](https://bun.sh) and Docker (for local Postgres + Mailpit).

```bash
bun install
cp api/.env.example api/.env
bun run dev
```

`bun run dev` starts Postgres and Mailpit, applies migrations, then runs the API
(`:3000`) and app (`:5173`). Open http://localhost:5173 — a fresh instance
redirects to `/setup`.

| command | |
| --- | --- |
| `bun run dev` | services + migrations + API + app |
| `bun run build` | build the admin UI |
| `bun run typecheck` | type-check both packages |
| `bun run test` | API test suite |
| `bun run migrate[:down\|:list]` | migrations |

## Configuration

Four environment variables, nothing else:

| variable | |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `AUTH_SECRET` | 32+ characters |
| `PORT` | default `3000` |
| `BASE_URL` | public app origin (default `http://localhost:5173`) |

Currency, locale, tax and the first admin are chosen at first-run setup, not from
the environment.

## Deployment

One container serves the API and the built admin UI from a single origin — no
separate web server or proxy.

```bash
docker build -t commerce .
docker compose up -d api
```

The container applies migrations then starts; `BASE_URL` is its public origin, so
cookies stay first-party. Uploaded media lives on local disk — mount a volume
(compose does) or swap in object storage.

Images are published to GitHub Container Registry by
`.github/workflows/publish.yml` on `main` and `v*` tags:

```bash
docker run -p 3000:3000 \
  -e DATABASE_URL=postgres://… \
  -e AUTH_SECRET=<32+ chars> \
  -e PORT=3000 \
  -e BASE_URL=https://your.domain \
  -v commerce-media:/app/api/storage/media \
  ghcr.io/<owner>/<repo>:latest
```

GHCR packages start private; flip the visibility in the package settings for
anonymous pulls.

## Roadmap

Next: DIAN e-invoicing, more payment gateways (MercadoPago/PayU), shipping rates
and shipments, discounts, collections, i18n.
