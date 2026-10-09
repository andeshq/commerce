# commerce

Headless commerce platform. Hono + Kysely + Better Auth + pgbase, with Postgres
RLS as the single authorization system.

## Repository layout

Bun workspace monorepo. One root `bun.lock` and hoisted `node_modules`.

```
package.json         workspace root (scripts for both packages)
compose.yaml         Postgres + Mailpit for local development (shared)
api/                 backend: HTTP API, auth, migrations, pgbase REST, RLS
app/                 frontend: React Router (data mode) SPA + React 19 + Tailwind v4 + HeroUI
```

Packages: `commerce-api` (`api/`) and `commerce-app` (`app/`).

## API architecture

- **Better Auth** owns identity (users, sessions, credentials) in the isolated
  `auth` schema.
- **pgbase** turns a resolved session into `SET LOCAL ROLE` + claim GUCs, so
  every request runs under a Postgres role.
- **Postgres RLS** is the authorization layer. There is no app-side permission
  check to keep in sync.
- **Kysely** is the query layer; `Database` extends `Kysely` and is injected
  everywhere.
- **tsyringe** wires the graph. Classes resolve by runtime type — no `@inject`
  tokens. Use value imports (`import { Config }`, not `import type`) for any
  constructor dependency, or tsyringe cannot build the token.

## API layout

```
api/
  src/
    main.ts                   entry: reflect-metadata, resolve graph, serve
    config/config.ts          Config (4 env vars, validated with zod)
    database/
      database.ts             Database extends Kysely (pg pool)
      types.ts                Kysely schema interface
      migrate.ts              migration runner (up/down/list)
      migrations/             per-concern Kysely migrations
    lib/
      auth.ts                 Auth: better-auth + admin plugin, handle()
      pgbase.ts               Pgbase: session -> role/claims -> REST handler
      app.ts                  App: Hono, logger, secure headers, routes
    service/setup.service.ts  first-run bootstrap
```

## Roles

Postgres roles are prefixed `web_` and map 1:1 from the app role:

| app role (better-auth `user.role`) | Postgres role |
| --- | --- |
| – (no session) | `web_anon` |
| `customer` | `web_customer` |
| `staff` | `web_staff` |
| `admin` | `web_admin` |

`web_customer` inherits `web_anon`; `web_staff` inherits `web_customer`;
`web_admin` inherits `web_staff`.

## Environment

Only four variables:

```
DATABASE_URL   postgres connection string
AUTH_SECRET    32+ characters
PORT           default 3000
BASE_URL       default http://localhost:5173 (public app origin)
```

`BASE_URL` is the origin the browser talks to (the app), not the API port.
Better Auth trusts this origin and the app proxies `/api` and `/rest` to the API,
so cookies stay first-party.

Everything else (schemas, base path, anon role, row caps, currency, locale,
tax-inclusive pricing) is hardcoded in `api/src/config/config.ts`. Store settings
and the first admin are created at first-run setup, not from env.

## Development

Run everything from the repo root:

```bash
bun install
cp api/.env.example api/.env
bun run dev              # services + migrations + API (:3000) + app (:5173)
```

`bun run dev` starts Postgres and Mailpit, applies pending migrations, then runs
the API and app together (`--parallel`). Open http://localhost:5173 — a fresh
instance redirects to `/setup`.

Root scripts (delegating to workspaces):

```
bun run dev                   services + migrate + both dev servers
bun run build                 app production build
bun run typecheck             both packages
bun run test                  API test suite
bun run migrate[:down|:list]  migrations
bun run services:up / down    Postgres + Mailpit (compose.yaml)
```

Local services from `compose.yaml`:

| service | address | purpose |
| --- | --- | --- |
| `database` | `localhost:5432` | Postgres 18 |
| `mailpit` | `localhost:8025` (UI), `localhost:1025` (SMTP) | catch and inspect outgoing email |

You can still run a command inside a package directly (e.g. `cd api && bun run dev`).

Routes: `/health`, `/api/auth/*` (Better Auth), `/api/setup` +
`/api/setup/status` (first-run bootstrap), `/rest/*` (pgbase).

## Admin UI

`app/` is a React Router (data mode) SPA built with HeroUI v3 + Tailwind v4. The
theme lives in `app/styles/globals.css`, overriding HeroUI tokens (`--background`,
`--surface`, `--accent`, `--muted`, shadows) so the storefront, setup wizard and
admin share one look: warm gray canvas, white surfaces, `#ed5229` accent.

Conventions:

- Routes live in `app/routes/<feature>/<name>.tsx` and are wired in
  `app/router.tsx` (`createBrowserRouter`). Each route module exports
  `Component`, and optionally `loader` (read) and `action` (write).
- Data access goes through `@supabase/postgrest-js` (`app/lib/pgbase.ts`): pgbase
  speaks the PostgREST protocol, so the official client works unchanged. Reads,
  inserts, updates and deletes are all plain `pgbase.from(table)…` builders.
- Use HeroUI components for every primitive (`Card`, `Table`, `Chip`, `Dropdown`,
  `SearchField`, `Avatar`, `ProgressBar`, …). Don't hand-roll equivalents.
- Navigate with `Link` or `useNavigate()`, not `Button` — HeroUI's `render` prop
  is documented as button-only, so a button cannot render an `<a>`. HeroUI
  `Link`s are routed client-side by React Aria's `RouterProvider` (mounted in
  `routes/root/rootLayout.tsx`).
- Page data comes from route `loader`s: guards and not-found redirects run in
  loaders (`throw redirect(...)`), before the route renders. Writes go through
  route `action`s (submitted with `useFetcher`/`useSubmit`); React Router
  revalidates the route's loaders automatically afterwards, so no manual cache
  invalidation is needed. Dialog/inline writes (inventory adjust, variant
  images, media, locations) call pgbase/RPC directly and then call
  `useRevalidator().revalidate()`.
- Imports use the `@/` alias (tsconfig `paths` + Vite `resolve.alias`, both
  rooted at `app/`) instead of deep relative paths: `@/lib/pgbase`,
  `@/lib/product-form`.
- Forms use `react-hook-form` with `zod` schemas through
  `@hookform/resolvers/zod`. Schemas own validation and the inferred types
  (`app/lib/product-schema.ts`); HeroUI fields are wired with `Controller` and
  render `FieldError` from `fieldState.error?.message`. Actions re-validate the
  same schemas with `safeParse` and return `{ errors }` for the form's alert.
- Auth uses Better Auth's React client (`app/lib/auth-client.ts`). Requests go
  to the relative `/api/auth` path, which Vite proxies to the API, so the
  session cookie stays on the app origin. `useSession()` feeds the auth context
  and `getSession()` backs the admin layout loader (the staff gate).

## Catalog privacy

Unit cost (COGS) lives in `commerce.product_variant_costs`, a staff-only table,
rather than on `product_variants`. pgbase expands `select=*` to every
introspected column, so a sensitive column on a publicly readable table cannot
be hidden with column-level grants without breaking `select=*`. Keeping cost in
its own relation makes the public variant shape safe by construction.

`pgbase` exposure is default-deny: only relations listed in `EXPOSED_TABLES`
(`api/src/config/config.ts`) are reachable. A new table stays private until added
there. Row access is still governed by RLS; the list only controls reachability.

Money is `bigint` cents. Top-level reads return it as a string, but embedded
reads serialize through Postgres `json_agg` as JSON numbers, which can lose
precision. Storefront selects should cast money columns to text, e.g.
`?select=variants:product_variants(price_cents::text)`.

## Options and variants

Options are store-scoped (Square-style): `options` + `option_values` are defined
once in the option library and linked to any product through `product_options`.
`variant_option_values` links a variant to the values it represents. `options.name`
is unique across the store and `product_options.option_id` is `on delete restrict`,
so an option in use cannot be deleted.

Saving a product is one nested pgbase request:

| Step | Request |
| --- | --- |
| Create | `POST /rest/products` with `product_options`, `product_variants` (+ `variant_option_values`, `product_variant_costs`) |
| Update | `PATCH /rest/products?id=eq.…` with `options: [{id}]` and variants by PK |
| Remove | explicit `DELETE` — nested writes never delete |

Nested-write shapes are not uniform; `app/lib/product-draft.ts` is the single place
that encodes the rules:

- `POST` inserts related rows, so links go through the junction tables
  (`product_options`, `variant_option_values`).
- `PATCH` treats an element **with** its primary key as an update and **without**
  as an insert — there is no upsert, a key with no matching row is an error — and
  ensures many-to-many links through the related table (`options`, `option_values`).
  A new variant inside a `PATCH` is an insert, so it uses the junction shape.
- Costs live in the staff-only `product_variant_costs`; on `PATCH` the row must
  carry `variant_id` to take the update path.
- Removals are separate `DELETE` requests; removing a variant cascades its links,
  cost and inventory rows.

Money stays bigint cents in the database. The admin takes currency units and
converts (`toCents`), formatting with `Intl.NumberFormat` from `store_settings`
(COP · es-CO by default).

Store currency and locale are **code-level options**: `app/lib/ref-data.ts`
defines the lists and labels (`COP — Colombian peso`, `Español (Colombia)`),
mirrored by zod enums in the setup and settings schemas; the database only
enforces the code *format* (`store_settings_currency_code_format`,
`store_settings_locale_format`). Locale codes keep their region on purpose —
`es-CO` is what makes COP render as `$ 79.900`, while a flat `es` would fall
back to Spain's conventions (`79.900 COP`).

## Inventory

Stock lives in `inventory_levels` / `inventory_movements`, both keyed by
`inventory_locations`. Locations are managed from the Inventory page header
("Manage locations…"):

- first-run **setup creates the store's first location**, named in the setup
  language — `Tienda principal` (`es-CO`) or `Main location` (`en-US`), code
  `MAIN` — so stock is adjustable immediately;
- a location carries an optional code and a free-form `address` jsonb
  (`line1`/`line2`/`city`/`region`/`postalCode`/`country`), edited in the dialog.
  Codes are unique **case-insensitively** (`MAIN` == `main`, migration
  `20260101000011`) and may be omitted;
- deleting a location cascades its levels and movement history, so the UI
  confirms it first. **Deactivating** is the reversible option: inactive
  locations are rejected by `commerce.adjust_inventory` and hidden from the
  adjustment pickers.

`inventory_locations` is staff-only. `inventory_levels` and
`inventory_movements` are written exclusively through the `adjust_inventory`
RPC.

## Cart, checkout and orders

The storefront is headless: it talks to `/rest` and the cart/checkout
`SECURITY DEFINER` RPCs, never raw order tables.

- **Cart** (`commerce.cart_*`): a guest holds a secret `token` returned by
  `cart_create`; every mutation (`cart_add_item`, `cart_update_item`,
  `cart_remove_item`, `cart_get`, `cart_set_address`) validates that token and
  returns a rebuilt JSON document with live prices and availability. Carts are
  RPC-only and never exposed through pgbase.
- **Checkout** (`commerce.checkout`): validates the catalog, snapshots prices
  onto `order_items`, decrements stock at the **default location** through the
  shared ledger (`apply_inventory_movement`, reason `order_placed`), opens a
  `pending` payment, and converts the cart. It is idempotent on
  `idempotency_key`; it returns the order `access_token` guests use for
  `order_get`. Stock is taken at placement, not reserved.
- **Orders / payments** (`orders`, `order_items`, `order_events`, `payments`)
  are exposed over pgbase: staff see everything, a customer sees only rows whose
  `customer_id = commerce.current_user_id()`, and anon is denied. Money columns
  are `bigint`; select them `::text` when embedding.
- **Staff actions** (`order_mark_paid`, `order_fulfill`, `order_cancel`) are
  staff-only RPCs; cancel restocks through the ledger.

### Order lifecycle

- **Unpaid orders expire.** `commerce.expire_stale_orders(cutoff)` cancels
  `open` orders whose `payment_status` is `pending`/`failed` and `placed_at` is
  before the cutoff, restocking every line through the ledger (reason
  `order_expired`) and writing an `expired` event. `MaintenanceService` runs it
  on an interval (`ORDER_EXPIRY_MINUTES` = 30) from `main.ts`. It is safe on
  every replica: a transaction-scoped advisory lock makes it single-runner per
  tick and `for update skip locked` claims each order once. Wompi's
  `expiration-time` is set to the same window.
- **Payment state is monotonic.** `PaymentService` records the event time and
  ignores out-of-order events, and never downgrades a terminal payment
  (`paid`/`refunded`/`voided`) back to `pending`/`failed`. Money that arrives
  after a cancel is **flagged** (`payment_after_cancel` event) rather than
  silently re-taking stock that may already be sold.
- **Multiple providers.** Several gateways can be enabled at once, ordered by
  `position`, with one `is_default` (partial unique index) used when the customer
  doesn't choose. `checkout` is provider-agnostic — it no longer creates a
  payment; the row is created when the customer starts a payment.

### Payments

Gateways implement the `PaymentProvider` interface
(`api/src/service/payment/`). `fake` ships first: `POST
/api/checkout/:orderToken/pay` returns a client payload, and confirmation
arrives at `POST /api/payments/:provider/webhook`, which is idempotent per
`(provider, event_id)`. Webhooks carry no session, so `PaymentService` applies
them on the owner connection. Provider config (enabled/mode/credentials) lives
in `commerce.payment_providers`, is edited admin-only via
`/api/payments/providers`, and is **never** returned to clients.

Several providers can be enabled at once, ordered by `position`, with one
`is_default`. `GET /api/payments/methods` (public) lists the enabled gateways
with their display name, supported methods/currencies, and the default.
`POST /api/checkout/:orderToken/pay` takes `{ provider?, method? }` — the
default when omitted — and creates (or reuses) the pending `payments` row for
that order + provider before returning the intent.

**Wompi** (Colombia) is the first real gateway
(`api/src/service/payment/wompi.provider.ts`). It uses **Web Checkout**: `pay`
returns a signed `checkout_url` (`https://checkout.wompi.co/p/?…`) built from the
public key, amount, reference and an integrity signature —
`SHA256(reference + amount_in_cents + currency + integritySecret)`. Confirmation
arrives as a `transaction.updated` event; the provider verifies Wompi's checksum
(`SHA256(property values + timestamp + eventsSecret)`, compared against the
`X-Event-Checksum` header) and maps `APPROVED/DECLINED/VOIDED/ERROR` onto
`payment_status`. The gateway's transaction id is kept in `payments.metadata`
so a refund can void it. Keys live in the provider's `credentials`
(`publicKey`, `privateKey`, `integritySecret`, `eventsSecret`), pasted in
Settings → Payments; sandbox vs production is selected by `mode` and the key
prefix. Enable exactly one provider at a time — checkout takes the single enabled
row.

## Tax

Tax lives in the database and is computed at checkout:

- `store_settings.tax_rate_bps` (basis points, e.g. `1900` = 19%) plus
  `tax_label` ("IVA"). First-run setup seeds `1900`/`IVA` for `es-CO` and
  `0`/`Tax` otherwise.
- `product_variants.tax_rate_bps` overrides the store rate per variant;
  `product_variants.taxable = false` forces 0%.
- `store_settings.prices_include_tax` decides whether catalog prices already
  contain tax.
- `commerce.effective_tax_rate_bps(variant)` is the single resolver, used by
  both `cart_payload` (an estimate the client can display) and `checkout`.

Rule, per line: `subtotal_cents` is the tax-exclusive base, `tax_cents` the tax,
and `total_cents = subtotal + tax`. Inclusive prices are back-calculated
(`tax = round(gross × r / (10000 + r))`); exclusive prices add on top
(`tax = round(net × r / 10000)`), rounded per line. `order_items.tax_rate_bps`
snapshots the rate so historical orders never move when settings change.
Shipping and discounts are `0` for now; DIAN electronic invoicing is a later
phase.

## Storefront API

The storefront reads a curated surface instead of composing the admin schema.
It's a documented contract, not an enforced boundary — RLS still governs rows,
and the raw tables stay reachable because the admin and the invoker views need
them.

- **`storefront_products`** (`security_invoker`): one row per product with
  `title, slug, vendor, product_type, category_id/category_name/category_slug,
  price_min_cents, price_max_cents, compare_at_min_cents (all text),
  variant_count, in_stock, image_url, image_alt, search`. Aggregates and a
  first-image pick; RLS keeps drafts out of anon.
- **`storefront_categories`** (`security_invoker`): `id, parent_id, name, slug,
  description, position, product_count`.
- **`storefront_product(slug)`** RPC: the whole product page in one call —
  variants (price, compare-at, option values, media, `in_stock`), options with
  values, modifiers with values. `SECURITY INVOKER`, so a draft slug returns
  `null`.
- **`variant_in_stock(variant)`**: the only public stock probe — `SECURITY
  DEFINER` (inventory is staff-only), a boolean at the **default location**
  (matching checkout). Exact levels are never exposed.

Recipes:

```
GET /rest/storefront_products?select=title,slug,price_min_cents,image_url,in_stock&order=price_min_cents.asc&limit=24
GET /rest/storefront_products?category_slug=eq.ropa
GET /rest/storefront_products?search=plfts(spanish).camiseta
GET /rest/storefront_categories?select=name,slug,product_count&order=position.asc
POST /rest/rpc/storefront_product   { "slug": "camiseta-basica" }
```

Search uses the `search` tsvector column with pgbase's FTS operators (`fts`,
`plfts`, `phfts`, `wfts`). The view builds it with the `spanish` config, so the
query must use the same config: `?search=plfts(spanish).term`. A GIN index on the
same expression over `products` backs it. Switching languages is a one-line
change in the view (and the index).

## Migrations

Kysely migrations, one concern per file, run with `Migrator` (database-locked).

```bash
bun run migrate          # up
bun run migrate:down     # roll back one
bun run migrate:list     # status
```

DDL (schemas, roles, policies) lives in migrations. Auth tables are generated
once with `bunx auth generate --adapter kysely` and pasted in verbatim so the
schema is frozen in time.

## Auth tables

`20260101000002_auth.ts` was generated from the Better Auth config
(email + password, admin plugin) and targets the `auth` schema. To regenerate
after changing auth config, point a scratch database at `schemaName: "auth"`,
run the CLI, and diff the output into the migration.

## Deployment

One container serves the API **and** the built admin UI from a single origin
(the static handler in `api/src/lib/app.ts`); there is no separate web server or
proxy.

```bash
docker build -t commerce .
docker compose up -d api        # database + api on :3000
```

- Only the four env vars are needed: `DATABASE_URL`, `AUTH_SECRET` (32+ chars),
  `PORT`, `BASE_URL`. In the image `BASE_URL` is the **public origin** of the
  API — which is also the app — so auth cookies stay first-party and there is no
  CORS.
- The container runs `migrate` then `start`; migrations are idempotent and
  database-locked, so a fresh deploy self-applies.
- Hashed assets are served `immutable`, `index.html` is `no-store`, and unknown
  paths fall back to `index.html` for client-side routing.
- Uploaded media lives on local disk (`api/storage/media`); compose mounts a
  volume for it. Swap `MediaService` for object storage to run stateless.
- The image sets `NODE_ENV=production`; the API only serves the UI in
  production (development keeps using Vite on :5173).

### Publishing to GHCR

`.github/workflows/publish.yml` runs typecheck + tests on every push/PR, then on
`main` and `v*` tags builds and pushes the image to GitHub Container Registry:

```
ghcr.io/<owner>/<repo>:latest
ghcr.io/<owner>/<repo>:sha-<short>
ghcr.io/<owner>/<repo>:<tag>
```

It authenticates with the built-in `GITHUB_TOKEN` (no extra secrets) and needs
`packages: write`. The repo has to be on GitHub first:

```bash
git init && git add -A && git commit -m "Initial commit"
git branch -M main
git remote add origin git@github.com:<owner>/<repo>.git
git push -u origin main
```

Then pull and run (only the four env vars; the API serves the UI):

```bash
docker run -p 3000:3000 \
  -e DATABASE_URL=postgres://… \
  -e AUTH_SECRET=<32+ chars> \
  -e PORT=3000 \
  -e BASE_URL=https://shop.example.com \
  -v commerce-media:/app/api/storage/media \
  ghcr.io/<owner>/<repo>:latest
```

GHCR packages start **private** — flip the visibility in the package settings if
you want anonymous pulls. `platforms` in the workflow is `amd64,arm64`; drop
`arm64` if the emulated build is too slow.

## Roadmap

Foundation, catalog, inventory, cart → checkout → orders/payments (fake + Wompi),
tax, and the curated storefront read API land here. Next: DIAN e-invoicing,
more gateways (MercadoPago/PayU), shipping rates and shipments, collections
merchandising, i18n.

Deferred past v1: `collections` / `product_collections` exist in the schema
(with RLS and types) but are intentionally not exposed through pgbase or
surfaced in the admin yet. Shipping (`shipping_cents`) and discounts
(`discount_cents`) are recorded but always `0`. A separate Postgres `storefront`
schema is deferred until pgbase supports exposing more than one schema.
