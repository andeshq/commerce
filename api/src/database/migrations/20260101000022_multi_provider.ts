import { sql, type Kysely } from "kysely";

/**
 * Multiple payment providers.
 *
 * The single-enabled constraint is dropped: several gateways may be enabled at
 * once, ordered by `position`, with one explicit `is_default` (used when the
 * customer doesn't pick). `checkout` becomes provider-agnostic — it no longer
 * creates a `payments` row; the row is created when the customer starts a
 * payment at `POST /api/checkout/:token/pay`.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    drop index if exists commerce.payment_providers_single_enabled;

    alter table commerce.payment_providers
      add column position integer not null default 0,
      add column is_default boolean not null default false;

    create unique index payment_providers_default_key
      on commerce.payment_providers (is_default) where is_default;

    update commerce.payment_providers
      set is_default = true
      where provider = 'fake'
        and not exists (select 1 from commerce.payment_providers where is_default);
  `).execute(db);

  await sql.raw(`
    create or replace function commerce.set_default_provider(p_slug text)
      returns void
      language plpgsql security definer set search_path = ''
    as $$
    declare
      v_role text := current_setting('role', true);
    begin
      if v_role is null or v_role not in ('web_staff', 'web_admin') then
        raise exception 'Staff access required.' using errcode = '42501';
      end if;
      if not exists (select 1 from commerce.payment_providers where provider = p_slug) then
        raise exception 'Provider not found.' using errcode = 'P0001';
      end if;
      update commerce.payment_providers
        set is_default = false
        where is_default and provider <> p_slug;
      update commerce.payment_providers
        set is_default = true
        where provider = p_slug;
    end;
    $$;

    revoke all on function commerce.set_default_provider(text) from public;
    grant execute on function commerce.set_default_provider(text) to web_staff, web_admin;
  `).execute(db);

  // checkout no longer selects a provider or inserts a payment.
  await sql.raw(`
    create or replace function commerce.checkout(
      p_cart_token text,
      p_email text default null,
      p_shipping_address jsonb default null,
      p_billing_address jsonb default null,
      p_note text default null,
      p_idempotency_key text default null
    ) returns table (order_id uuid, number bigint, access_token text, total_cents bigint)
      language plpgsql security definer set search_path = ''
    as $$
    declare
      v_cart commerce.carts;
      v_existing commerce.orders;
      v_location uuid;
      v_currency text;
      v_include boolean;
      v_store_rate integer;
      v_actor text := commerce.current_user_id();
      v_email text;
      v_order_id uuid;
      v_number bigint;
      v_access text;
      v_subtotal bigint := 0;
      v_tax bigint := 0;
      v_total bigint := 0;
      v_rate integer;
      v_gross bigint;
      v_line_tax bigint;
      v_item record;
    begin
      if p_idempotency_key is not null and p_idempotency_key <> '' then
        select * into v_existing
        from commerce.orders where idempotency_key = p_idempotency_key;
        if found then
          return query select v_existing.id, v_existing.number,
                              v_existing.access_token, v_existing.total_cents;
          return;
        end if;
      end if;

      v_cart := commerce.cart_by_token(p_cart_token);

      if not exists (select 1 from commerce.cart_items where cart_id = v_cart.id) then
        raise exception 'The cart is empty.' using errcode = 'P0001';
      end if;

      v_location := commerce.default_location();
      if v_location is null then
        raise exception 'No fulfillment location is configured.' using errcode = 'P0001';
      end if;

      v_email := coalesce(nullif(trim(p_email), ''), v_cart.email);
      if v_email is null then
        raise exception 'An email address is required.' using errcode = 'P0001';
      end if;

      select currency_code, tax_rate_bps, prices_include_tax
        into v_currency, v_store_rate, v_include
        from commerce.store_settings limit 1;
      v_store_rate := coalesce(v_store_rate, 0);
      v_include := coalesce(v_include, false);

      -- One pass: validate status, sum net subtotal and tax.
      for v_item in
        select ci.quantity, v.price_cents, v.taxable, v.tax_rate_bps, p.status
        from commerce.cart_items ci
        join commerce.product_variants v on v.id = ci.variant_id
        join commerce.products p on p.id = v.product_id
        where ci.cart_id = v_cart.id
      loop
        if v_item.status <> 'active' then
          raise exception 'An item in the cart is no longer available.' using errcode = 'P0001';
        end if;

        v_rate := case
          when v_item.taxable then coalesce(v_item.tax_rate_bps, v_store_rate)
          else 0
        end;
        v_gross := v_item.quantity * v_item.price_cents;

        if v_include then
          v_line_tax := round(v_gross::numeric * v_rate / (10000 + v_rate))::bigint;
          v_subtotal := v_subtotal + (v_gross - v_line_tax);
        else
          v_line_tax := round(v_gross::numeric * v_rate / 10000)::bigint;
          v_subtotal := v_subtotal + v_gross;
        end if;
        v_tax := v_tax + v_line_tax;
      end loop;

      v_total := v_subtotal + v_tax;

      insert into commerce.orders (
        customer_id, email, currency_code, subtotal_cents, tax_cents, total_cents,
        shipping_address, billing_address, note, idempotency_key
      ) values (
        v_actor, v_email, v_currency, v_subtotal, v_tax, v_total,
        coalesce(p_shipping_address, v_cart.shipping_address),
        p_billing_address, nullif(trim(p_note), ''), nullif(p_idempotency_key, '')
      )
      returning commerce.orders.id, commerce.orders.number, commerce.orders.access_token
        into v_order_id, v_number, v_access;

      -- Snapshot the lines and take the stock.
      for v_item in
        select ci.variant_id, ci.quantity, v.price_cents, v.compare_at_price_cents,
               v.taxable, v.tax_rate_bps,
               v.title as variant_title, v.sku, p.title as product_title, p.id as product_id
        from commerce.cart_items ci
        join commerce.product_variants v on v.id = ci.variant_id
        join commerce.products p on p.id = v.product_id
        where ci.cart_id = v_cart.id
        order by ci.created_at
      loop
        v_rate := case
          when v_item.taxable then coalesce(v_item.tax_rate_bps, v_store_rate)
          else 0
        end;
        v_gross := v_item.quantity * v_item.price_cents;
        if v_include then
          v_line_tax := round(v_gross::numeric * v_rate / (10000 + v_rate))::bigint;
        else
          v_line_tax := round(v_gross::numeric * v_rate / 10000)::bigint;
        end if;

        insert into commerce.order_items (
          order_id, variant_id, product_id, product_title, variant_title, sku,
          quantity, unit_price_cents, unit_compare_at_cents, tax_cents, tax_rate_bps, total_cents
        ) values (
          v_order_id, v_item.variant_id, v_item.product_id, v_item.product_title,
          v_item.variant_title, v_item.sku, v_item.quantity, v_item.price_cents,
          v_item.compare_at_price_cents, v_line_tax, v_rate,
          case when v_include then v_gross else v_gross + v_line_tax end
        );

        perform commerce.apply_inventory_movement(
          v_item.variant_id,
          v_location,
          -(v_item.quantity),
          'order_placed',
          v_order_id::text,
          jsonb_build_object('order_number', v_number),
          null,
          null
        );
      end loop;

      insert into commerce.order_events (order_id, type, data, actor_id)
      values (
        v_order_id, 'placed',
        jsonb_build_object(
          'total_cents', v_total::text,
          'tax_cents', v_tax::text,
          'items', (select count(*) from commerce.order_items
                    where commerce.order_items.order_id = v_order_id)
        ),
        v_actor
      );

      update commerce.carts
        set status = 'converted', converted_order_id = v_order_id, converted_at = now()
        where id = v_cart.id;

      return query select v_order_id, v_number, v_access, v_total;
    end;
    $$;
  `).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    drop function if exists commerce.set_default_provider(text);
    drop index if exists commerce.payment_providers_default_key;
    alter table commerce.payment_providers
      drop column if exists is_default,
      drop column if exists position;
    create unique index payment_providers_single_enabled
      on commerce.payment_providers (enabled) where enabled;
  `).execute(db);
}
