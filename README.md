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

## API

Everything is same-origin REST. Catalog and order reads (and every write that
goes through the database) use **pgbase** under `/rest`, which speaks the
PostgREST protocol — so use `@supabase/postgrest-js` unchanged. The few things
pgbase doesn't cover (payments, media, setup) are plain **`fetch`** calls under
`/api`.

| Endpoint | Purpose | Client |
| --- | --- | --- |
| `GET /rest/storefront_products` | Product list — filter, `order`, `limit`, `search=plfts(spanish).term` | postgrest-js `.from()` |
| `GET /rest/storefront_categories` | Categories with product counts | postgrest-js `.from()` |
| `POST /rest/rpc/storefront_product` `{ p_slug }` | Full product page (variants, options, modifiers) | postgrest-js `.rpc()` |
| `POST /rest/rpc/cart_create` `{ p_email? }` | New cart → `{ id, token }` | postgrest-js `.rpc()` |
| `POST /rest/rpc/cart_add_item` `{ p_token, p_variant, p_quantity? }` | Add or increment a line | postgrest-js `.rpc()` |
| `POST /rest/rpc/cart_update_item` `{ p_token, p_item, p_quantity }` | Set a line's quantity (`0` removes it) | postgrest-js `.rpc()` |
| `POST /rest/rpc/cart_remove_item` `{ p_token, p_item }` | Remove a line | postgrest-js `.rpc()` |
| `POST /rest/rpc/cart_get` `{ p_token }` | Cart with live prices and availability | postgrest-js `.rpc()` |
| `POST /rest/rpc/checkout` `{ p_cart_token, p_email?, p_shipping_address?, … }` | Cart → order (idempotent) | postgrest-js `.rpc()` |
| `POST /rest/rpc/order_get` `{ p_token }` | An order by its access token | postgrest-js `.rpc()` |
| `GET /api/payments/methods` | Enabled gateways for a storefront | `fetch` |
| `POST /api/checkout/:orderToken/pay` `{ provider?, method? }` | Start a payment → intent | `fetch` |
| `POST /api/payments/:provider/webhook` | Gateway webhook (no session) | `fetch` (gateway) |
| `POST /api/orders/:id/refund` | Refund an order (staff) | `fetch` |
| `GET /rest/orders`, `/rest/products`, … | Admin reads/writes over exposed tables | postgrest-js |

```ts
import { PostgrestClient } from "@supabase/postgrest-js";

const db = new PostgrestClient("https://your.domain/rest");

// Catalog: plain PostgREST query builders.
const { data: products } = await db
  .from("storefront_products")
  .select("slug,title,price_min_cents,image_url,in_stock")
  .eq("category_slug", "ropa")
  .order("price_min_cents", { ascending: true })
  .limit(24);

// Cart & checkout are database functions (RPC).
const { data } = await db.rpc("cart_create", {});
const token = data[0].token; // scalar jsonb/table results come back as an array
await db.rpc("cart_add_item", { p_token: token, p_variant: variantId, p_quantity: 1 });

// Payments are plain fetch under /api.
const res = await fetch(`https://your.domain/api/checkout/${accessToken}/pay`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ provider: "wompi" }),
});
```

Two gotchas: RPCs that return a scalar (jsonb) come back as a **one-element
array** — unwrap `[0]` — and money columns are **text** (cast embedded money as
`price_cents::text`).

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
`.github/workflows/publish.yml` on `main` and `v*` tags, tagged by branch
(`main`), `sha-<short>`, and the version for `v*` tags:

```bash
docker run -p 3000:3000 \
  -e DATABASE_URL=postgres://… \
  -e AUTH_SECRET=<32+ chars> \
  -e PORT=3000 \
  -e BASE_URL=https://your.domain \
  -v commerce-media:/app/api/storage/media \
  ghcr.io/<owner>/<repo>:main
```

GHCR packages start private; flip the visibility in the package settings for
anonymous pulls.

CI needs two repo secrets so Docker Hub pulls aren't rate-limited (the test job
pulls Postgres, the build pulls the base image): `DOCKERHUB_USERNAME` and
`DOCKERHUB_TOKEN` — a free Docker Hub account and a read-only access token.

## Roadmap

Next: DIAN e-invoicing, more payment gateways (MercadoPago/PayU), shipping rates
and shipments, discounts, collections, i18n.
