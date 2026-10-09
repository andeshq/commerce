import { sql, type Kysely } from "kysely";

/**
 * Orders and payments.
 *
 * Orders are created by `commerce.checkout` (SECURITY DEFINER) and read over
 * pgbase: staff see everything, a customer sees only their own rows, guests use
 * the order `access_token` through an RPC. Money is snapshotted onto
 * `order_items` so later catalog edits cannot rewrite history.
 *
 * `payment_providers` and `payment_events` are server-only: no grant to any
 * `web_*` role, so credentials and raw webhook payloads never travel over REST.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    -- Re-declared as text (user ids are text); replaces the uuid version.
    drop function if exists commerce.current_user_id();
    create or replace function commerce.current_user_id() returns text
      language sql stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')
    $$;
    grant execute on function commerce.current_user_id()
      to web_anon, web_customer, web_staff, web_admin;

    create type commerce.order_status as enum ('open', 'completed', 'cancelled');
    create type commerce.payment_status as enum (
      'pending', 'authorized', 'paid', 'failed', 'refunded', 'partially_refunded', 'voided'
    );
    create type commerce.fulfillment_status as enum (
      'unfulfilled', 'partially_fulfilled', 'fulfilled'
    );
    create type commerce.payment_mode as enum ('test', 'live');

    create sequence commerce.order_number_seq start with 1001;

    create table commerce.orders (
      id uuid primary key default gen_random_uuid(),
      number bigint not null default nextval('commerce.order_number_seq') unique,
      access_token text not null unique default encode(gen_random_bytes(32), 'hex'),
      customer_id text references auth."user" (id) on delete set null,
      email text not null,
      phone text,
      status commerce.order_status not null default 'open',
      payment_status commerce.payment_status not null default 'pending',
      fulfillment_status commerce.fulfillment_status not null default 'unfulfilled',
      currency_code text not null,
      subtotal_cents bigint not null default 0,
      discount_cents bigint not null default 0,
      tax_cents bigint not null default 0,
      shipping_cents bigint not null default 0,
      total_cents bigint not null default 0,
      shipping_address jsonb,
      billing_address jsonb,
      note text,
      idempotency_key text unique,
      placed_at timestamptz not null default now(),
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint orders_money_non_negative check (
        subtotal_cents >= 0 and discount_cents >= 0 and tax_cents >= 0
        and shipping_cents >= 0 and total_cents >= 0
      )
    );

    create index orders_customer_id_idx on commerce.orders (customer_id);
    create index orders_status_idx on commerce.orders (status);
    create index orders_payment_status_idx on commerce.orders (payment_status);
    create index orders_placed_at_idx on commerce.orders (placed_at desc);

    create trigger orders_updated_at
      before update on commerce.orders
      for each row execute function commerce.set_updated_at();

    create table commerce.order_items (
      id uuid primary key default gen_random_uuid(),
      order_id uuid not null references commerce.orders (id) on delete cascade,
      variant_id uuid references commerce.product_variants (id) on delete set null,
      product_id uuid,
      product_title text not null,
      variant_title text not null,
      sku text,
      quantity integer not null check (quantity > 0),
      unit_price_cents bigint not null check (unit_price_cents >= 0),
      unit_compare_at_cents bigint,
      tax_cents bigint not null default 0,
      total_cents bigint not null,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create index order_items_order_id_idx on commerce.order_items (order_id);
    create index order_items_variant_id_idx on commerce.order_items (variant_id);

    create table commerce.order_events (
      id uuid primary key default gen_random_uuid(),
      order_id uuid not null references commerce.orders (id) on delete cascade,
      type text not null,
      data jsonb not null default '{}'::jsonb,
      actor_id text references auth."user" (id) on delete set null,
      actor_name text,
      created_at timestamptz not null default now()
    );

    create index order_events_order_id_idx on commerce.order_events (order_id);

    create table commerce.payments (
      id uuid primary key default gen_random_uuid(),
      order_id uuid not null references commerce.orders (id) on delete cascade,
      provider text not null,
      method text,
      status commerce.payment_status not null default 'pending',
      amount_cents bigint not null check (amount_cents >= 0),
      currency_code text not null,
      provider_ref text unique,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index payments_order_id_idx on commerce.payments (order_id);

    create trigger payments_updated_at
      before update on commerce.payments
      for each row execute function commerce.set_updated_at();

    -- Server-only: gateway configuration and webhook dedupe.
    create table commerce.payment_providers (
      provider text primary key,
      enabled boolean not null default false,
      mode commerce.payment_mode not null default 'test',
      credentials jsonb not null default '{}'::jsonb,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create trigger payment_providers_updated_at
      before update on commerce.payment_providers
      for each row execute function commerce.set_updated_at();

    create table commerce.payment_events (
      id uuid primary key default gen_random_uuid(),
      provider text not null,
      event_id text not null,
      payment_id uuid references commerce.payments (id) on delete set null,
      payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      unique (provider, event_id)
    );

    insert into commerce.payment_providers (provider, enabled)
      values ('fake', true);

    grant select on commerce.orders to web_customer, web_staff, web_admin;
    grant insert, update, delete on commerce.orders to web_staff, web_admin;
    grant select on commerce.order_items to web_customer, web_staff, web_admin;
    grant insert, update, delete on commerce.order_items to web_staff, web_admin;
    grant select on commerce.order_events to web_customer, web_staff, web_admin;
    grant insert, update, delete on commerce.order_events to web_staff, web_admin;
    grant select on commerce.payments to web_customer, web_staff, web_admin;
    grant insert, update, delete on commerce.payments to web_staff, web_admin;

    grant usage on type commerce.order_status, commerce.payment_status,
      commerce.fulfillment_status to web_customer, web_staff, web_admin;
    grant usage on type commerce.payment_mode to web_staff, web_admin;

    alter table commerce.orders enable row level security;
    alter table commerce.order_items enable row level security;
    alter table commerce.order_events enable row level security;
    alter table commerce.payments enable row level security;
    alter table commerce.payment_providers enable row level security;
    alter table commerce.payment_events enable row level security;

    create policy orders_read on commerce.orders
      for select using (
        commerce.is_staff() or customer_id = commerce.current_user_id()
      );
    create policy orders_write on commerce.orders
      for all using (commerce.is_staff()) with check (commerce.is_staff());

    create policy order_items_read on commerce.order_items
      for select using (
        commerce.is_staff() or exists (
          select 1 from commerce.orders o
          where o.id = order_items.order_id and o.customer_id = commerce.current_user_id()
        )
      );
    create policy order_items_write on commerce.order_items
      for all using (commerce.is_staff()) with check (commerce.is_staff());

    create policy order_events_read on commerce.order_events
      for select using (
        commerce.is_staff() or exists (
          select 1 from commerce.orders o
          where o.id = order_events.order_id and o.customer_id = commerce.current_user_id()
        )
      );
    create policy order_events_write on commerce.order_events
      for all using (commerce.is_staff()) with check (commerce.is_staff());

    create policy payments_read on commerce.payments
      for select using (
        commerce.is_staff() or exists (
          select 1 from commerce.orders o
          where o.id = payments.order_id and o.customer_id = commerce.current_user_id()
        )
      );
    create policy payments_write on commerce.payments
      for all using (commerce.is_staff()) with check (commerce.is_staff());
  `).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    drop table if exists commerce.payment_events;
    drop table if exists commerce.payment_providers;
    drop table if exists commerce.payments;
    drop table if exists commerce.order_events;
    drop table if exists commerce.order_items;
    drop table if exists commerce.orders;
    drop sequence if exists commerce.order_number_seq;
    drop type if exists commerce.payment_mode;
    drop type if exists commerce.fulfillment_status;
    drop type if exists commerce.payment_status;
    drop type if exists commerce.order_status;
  `).execute(db);
}
