import { sql, type Kysely } from "kysely";

/**
 * Carts. Carts are RPC-only (no grant to any `web_*` role, not exposed through
 * pgbase): a guest holds a secret `token` and every mutation runs through a
 * SECURITY DEFINER function that validates it. Signed-in customers get the same
 * functions, with the token linking the cart to their account.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    create type commerce.cart_status as enum ('open', 'converted', 'abandoned');

    create table commerce.carts (
      id uuid primary key default gen_random_uuid(),
      token text not null unique default encode(gen_random_bytes(32), 'hex'),
      customer_id text references auth."user" (id) on delete set null,
      email text,
      currency_code text not null,
      status commerce.cart_status not null default 'open',
      shipping_address jsonb,
      converted_order_id uuid references commerce.orders (id) on delete set null,
      metadata jsonb not null default '{}'::jsonb,
      converted_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index carts_customer_id_idx on commerce.carts (customer_id);

    create trigger carts_updated_at
      before update on commerce.carts
      for each row execute function commerce.set_updated_at();

    create table commerce.cart_items (
      id uuid primary key default gen_random_uuid(),
      cart_id uuid not null references commerce.carts (id) on delete cascade,
      variant_id uuid not null references commerce.product_variants (id) on delete cascade,
      quantity integer not null check (quantity > 0),
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (cart_id, variant_id)
    );

    create index cart_items_cart_id_idx on commerce.cart_items (cart_id);

    create trigger cart_items_updated_at
      before update on commerce.cart_items
      for each row execute function commerce.set_updated_at();

    grant usage on type commerce.cart_status to web_customer, web_staff, web_admin;

    alter table commerce.carts enable row level security;
    alter table commerce.cart_items enable row level security;
  `).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    drop table if exists commerce.cart_items;
    drop table if exists commerce.carts;
    drop type if exists commerce.cart_status;
  `).execute(db);
}
