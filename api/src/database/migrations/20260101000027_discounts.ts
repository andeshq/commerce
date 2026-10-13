import { type Kysely, sql } from "kysely";

/**
 * Discount codes.
 *
 * `commerce.discounts` is staff-only: codes are never readable by anon, so a
 * guest cannot enumerate them. Redemption happens through SECURITY DEFINER
 * functions — `cart_apply_discount` / `cart_remove_discount` for the cart and
 * `checkout` for the order.
 *
 * Money rule (extends tax): `subtotal_cents` is the tax-exclusive base,
 * `discount_cents` is taken off that base, tax is recomputed on the reduced
 * base, and `total_cents = subtotal - discount + tax`. The discount never
 * exceeds the subtotal, and it is re-validated at checkout, not merely when the
 * code is entered.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(`
    create type commerce.discount_type as enum ('percentage', 'fixed');

    create table commerce.discounts (
      id uuid primary key default gen_random_uuid(),
      code text not null unique,
      description text,
      type commerce.discount_type not null,
      -- percentage: basis points (1000 = 10%); fixed: cents
      value integer not null,
      min_subtotal_cents bigint not null default 0,
      starts_at timestamptz,
      ends_at timestamptz,
      usage_limit integer,
      times_used integer not null default 0,
      active boolean not null default true,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint discounts_code_format
        check (code = upper(code) and code ~ '^[A-Z0-9][A-Z0-9_-]{1,63}$'),
      constraint discounts_value_positive check (value > 0),
      constraint discounts_percentage_range check (type <> 'percentage' or value <= 10000),
      constraint discounts_min_subtotal_non_negative check (min_subtotal_cents >= 0),
      constraint discounts_usage_limit_positive check (usage_limit is null or usage_limit > 0),
      constraint discounts_times_used_non_negative check (times_used >= 0),
      constraint discounts_window_order
        check (starts_at is null or ends_at is null or ends_at > starts_at)
    );

    create index discounts_active_idx on commerce.discounts (active) where active;

    create trigger discounts_updated_at
      before update on commerce.discounts
      for each row execute function commerce.set_updated_at();

    alter table commerce.orders add column discount_code text;
    alter table commerce.carts
      add column discount_id uuid references commerce.discounts (id) on delete set null;

    grant select, insert, update, delete on commerce.discounts to web_staff, web_admin;
    grant usage on type commerce.discount_type to web_staff, web_admin;

    alter table commerce.discounts enable row level security;

    create policy discounts_staff on commerce.discounts
      for all using (commerce.is_staff()) with check (commerce.is_staff());
  `)
    .execute(db);

  // The amount a discount takes off a tax-exclusive subtotal. One resolver, so
  // the cart estimate and the checkout snapshot can never disagree.
  await sql
    .raw(`
    create or replace function commerce.discount_amount(p_discount commerce.discounts, p_subtotal bigint)
      returns bigint
      language sql stable set search_path = ''
    as $$
      select case
        when p_discount.id is null or p_subtotal <= 0 then 0
        when p_subtotal < p_discount.min_subtotal_cents then 0
        when p_discount.type = 'percentage'
          then round(p_subtotal::numeric * p_discount.value / 10000)::bigint
        else least(p_discount.value::bigint, p_subtotal)
      end
    $$;

    create or replace function commerce.assert_discount_valid(p_discount commerce.discounts)
      returns void
      language plpgsql stable set search_path = ''
    as $$
    begin
      if p_discount.id is null then
        raise exception 'That discount code was not found.' using errcode = 'P0001';
      end if;
      if not p_discount.active then
        raise exception 'That discount code is not available.' using errcode = 'P0001';
      end if;
      if p_discount.starts_at is not null and now() < p_discount.starts_at then
        raise exception 'That discount code is not active yet.' using errcode = 'P0001';
      end if;
      if p_discount.ends_at is not null and now() > p_discount.ends_at then
        raise exception 'That discount code has expired.' using errcode = 'P0001';
      end if;
      if p_discount.usage_limit is not null and p_discount.times_used >= p_discount.usage_limit then
        raise exception 'That discount code has reached its usage limit.' using errcode = 'P0001';
      end if;
    end;
    $$;

    create or replace function commerce.discount_by_code(p_code text)
      returns commerce.discounts
      language plpgsql stable security definer set search_path = ''
    as $$
    declare
      v_code text := upper(nullif(trim(p_code), ''));
      v commerce.discounts;
    begin
      if v_code is null then
        raise exception 'Enter a discount code.' using errcode = 'P0001';
      end if;
      select * into v from commerce.discounts where code = v_code;
      if not found then
        raise exception 'That discount code was not found.' using errcode = 'P0001';
      end if;
      perform commerce.assert_discount_valid(v);
      return v;
    end;
    $$;
  `)
    .execute(db);

  // Cart payload with discount fields. `subtotal_cents` stays the pre-discount
  // tax-exclusive base; tax is scaled to the discounted base.
  await sql
    .raw(`
    create or replace function commerce.cart_payload(p_cart uuid) returns jsonb
      language sql stable security definer set search_path = ''
    as $$
      with store as (
        select prices_include_tax from commerce.store_settings limit 1
      ),
      line as (
        select
          ci.id,
          ci.variant_id,
          v.product_id,
          p.title as product_title,
          v.title as variant_title,
          v.sku,
          ci.quantity,
          v.price_cents as unit_price_cents,
          v.compare_at_price_cents,
          ci.created_at,
          s.prices_include_tax as inclusive,
          (ci.quantity * v.price_cents) as gross_cents,
          coalesce(il.available, 0) as available,
          case when s.prices_include_tax
            then round((ci.quantity * v.price_cents)::numeric
                 * commerce.effective_tax_rate_bps(ci.variant_id)
                 / (10000 + commerce.effective_tax_rate_bps(ci.variant_id)))::bigint
            else round((ci.quantity * v.price_cents)::numeric
                 * commerce.effective_tax_rate_bps(ci.variant_id) / 10000)::bigint
          end as tax_cents
        from commerce.cart_items ci
        join commerce.product_variants v on v.id = ci.variant_id
        join commerce.products p on p.id = v.product_id
        cross join store s
        left join commerce.inventory_locations l on l.is_default
        left join commerce.inventory_levels il
          on il.variant_id = ci.variant_id and il.location_id = l.id
        where ci.cart_id = p_cart
      ),
      totals as (
        select
          coalesce(sum(case when inclusive then gross_cents - tax_cents else gross_cents end), 0)::bigint
            as net_cents,
          coalesce(sum(tax_cents), 0)::bigint as tax_cents
        from line
      ),
      calc as (
        select
          t.net_cents,
          t.tax_cents,
          coalesce((
            select commerce.discount_amount(d, t.net_cents)
            from commerce.carts c
            join commerce.discounts d on d.id = c.discount_id
            where c.id = p_cart
          ), 0) as discount_cents
        from totals t
      ),
      final as (
        select
          net_cents,
          tax_cents,
          discount_cents,
          case when net_cents > 0
            then round(tax_cents::numeric * (net_cents - discount_cents) / net_cents)::bigint
            else 0
          end as tax_after
        from calc
      )
      select jsonb_build_object(
        'id', c.id,
        'token', c.token,
        'status', c.status,
        'currency_code', c.currency_code,
        'email', c.email,
        'shipping_address', c.shipping_address,
        'prices_include_tax', (select prices_include_tax from store),
        'item_count', coalesce((select sum(quantity) from line), 0),
        'subtotal_cents', f.net_cents::text,
        'discount_cents', f.discount_cents::text,
        'discount_code', (
          select d.code from commerce.carts cc
          join commerce.discounts d on d.id = cc.discount_id
          where cc.id = p_cart
        ),
        'tax_cents', f.tax_after::text,
        'total_cents', (f.net_cents - f.discount_cents + f.tax_after)::text,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', l.id,
            'variant_id', l.variant_id,
            'product_id', l.product_id,
            'product_title', l.product_title,
            'variant_title', l.variant_title,
            'sku', l.sku,
            'quantity', l.quantity,
            'unit_price_cents', l.unit_price_cents::text,
            'unit_compare_at_cents', l.compare_at_price_cents::text,
            'line_total_cents', (case when l.inclusive then l.gross_cents
                                      else l.gross_cents + l.tax_cents end)::text,
            'tax_cents', l.tax_cents::text,
            'available', l.available
          ) order by l.created_at)
          from line l
        ), '[]'::jsonb)
      )
      from commerce.carts c
      cross join final f
      where c.id = p_cart
    $$;
  `)
    .execute(db);

  await sql
    .raw(`
    create or replace function commerce.cart_apply_discount(p_token text, p_code text)
      returns jsonb
      language plpgsql security definer set search_path = ''
    as $$
    declare
      v_cart commerce.carts;
      v_discount commerce.discounts;
      v_subtotal bigint;
    begin
      v_cart := commerce.cart_by_token(p_token);
      v_discount := commerce.discount_by_code(p_code);

      v_subtotal := (commerce.cart_payload(v_cart.id) ->> 'subtotal_cents')::bigint;
      if v_subtotal < v_discount.min_subtotal_cents then
        raise exception 'This code requires a minimum subtotal of %.', v_discount.min_subtotal_cents
          using errcode = 'P0001';
      end if;

      update commerce.carts set discount_id = v_discount.id where id = v_cart.id;
      return commerce.cart_payload(v_cart.id);
    end;
    $$;

    create or replace function commerce.cart_remove_discount(p_token text)
      returns jsonb
      language plpgsql security definer set search_path = ''
    as $$
    declare
      v_cart commerce.carts;
    begin
      v_cart := commerce.cart_by_token(p_token);
      update commerce.carts set discount_id = null where id = v_cart.id;
      return commerce.cart_payload(v_cart.id);
    end;
    $$;
  `)
    .execute(db);

  await sql
    .raw(`
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
      v_provider text;
      v_actor text := commerce.current_user_id();
      v_email text;
      v_order_id uuid;
      v_number bigint;
      v_access text;
      v_subtotal bigint := 0;
      v_tax bigint := 0;
      v_discount commerce.discounts;
      v_discount_cents bigint := 0;
      v_discount_code text;
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

      select provider into v_provider
        from commerce.payment_providers where enabled order by provider limit 1;
      v_provider := coalesce(v_provider, 'fake');

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

      -- Re-validate the cart's code: it may have expired or been maxed out
      -- between being entered and checkout.
      if v_cart.discount_id is not null then
        select * into v_discount from commerce.discounts where id = v_cart.discount_id;
        if found then
          perform commerce.assert_discount_valid(v_discount);
          v_discount_cents := commerce.discount_amount(v_discount, v_subtotal);
          v_discount_code := v_discount.code;
        end if;
      end if;

      -- Tax follows the discounted base.
      if v_discount_cents > 0 and v_subtotal > 0 then
        v_tax := round(v_tax::numeric * (v_subtotal - v_discount_cents) / v_subtotal)::bigint;
      end if;

      v_total := v_subtotal - v_discount_cents + v_tax;

      insert into commerce.orders (
        customer_id, email, currency_code, subtotal_cents, discount_cents,
        tax_cents, total_cents, discount_code,
        shipping_address, billing_address, note, idempotency_key
      ) values (
        v_actor, v_email, v_currency, v_subtotal, v_discount_cents,
        v_tax, v_total, v_discount_code,
        coalesce(p_shipping_address, v_cart.shipping_address),
        p_billing_address, nullif(trim(p_note), ''), nullif(p_idempotency_key, '')
      )
      returning commerce.orders.id, commerce.orders.number, commerce.orders.access_token
        into v_order_id, v_number, v_access;

      if v_discount.id is not null then
        update commerce.discounts set times_used = times_used + 1 where id = v_discount.id;
      end if;

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

      insert into commerce.payments (order_id, provider, status, amount_cents, currency_code)
      values (v_order_id, v_provider, 'pending', v_total, v_currency);

      insert into commerce.order_events (order_id, type, data, actor_id)
      values (
        v_order_id, 'placed',
        jsonb_build_object(
          'total_cents', v_total::text,
          'discount_cents', v_discount_cents::text,
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
  `)
    .execute(db);

  await sql
    .raw(`
    revoke all on function commerce.discount_amount(commerce.discounts, bigint) from public;
    revoke all on function commerce.assert_discount_valid(commerce.discounts) from public;
    revoke all on function commerce.discount_by_code(text) from public;

    grant execute on function commerce.cart_apply_discount(text, text)
      to web_anon, web_customer, web_staff, web_admin;
    grant execute on function commerce.cart_remove_discount(text)
      to web_anon, web_customer, web_staff, web_admin;
  `)
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // Restore the tax-only cart/checkout before the columns become droppable.
  await sql
    .raw(`
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
      v_provider text;
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

      select provider into v_provider
        from commerce.payment_providers where enabled order by provider limit 1;
      v_provider := coalesce(v_provider, 'fake');

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
          v_item.variant_id, v_location, -(v_item.quantity), 'order_placed',
          v_order_id::text, jsonb_build_object('order_number', v_number), null, null
        );
      end loop;

      insert into commerce.payments (order_id, provider, status, amount_cents, currency_code)
      values (v_order_id, v_provider, 'pending', v_total, v_currency);

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

    create or replace function commerce.cart_payload(p_cart uuid) returns jsonb
      language sql stable security definer set search_path = ''
    as $$
      with store as (
        select prices_include_tax from commerce.store_settings limit 1
      ),
      line as (
        select
          ci.id,
          ci.variant_id,
          v.product_id,
          p.title as product_title,
          v.title as variant_title,
          v.sku,
          ci.quantity,
          v.price_cents as unit_price_cents,
          v.compare_at_price_cents,
          ci.created_at,
          s.prices_include_tax as inclusive,
          (ci.quantity * v.price_cents) as gross_cents,
          coalesce(il.available, 0) as available,
          case when s.prices_include_tax
            then round((ci.quantity * v.price_cents)::numeric
                 * commerce.effective_tax_rate_bps(ci.variant_id)
                 / (10000 + commerce.effective_tax_rate_bps(ci.variant_id)))::bigint
            else round((ci.quantity * v.price_cents)::numeric
                 * commerce.effective_tax_rate_bps(ci.variant_id) / 10000)::bigint
          end as tax_cents
        from commerce.cart_items ci
        join commerce.product_variants v on v.id = ci.variant_id
        join commerce.products p on p.id = v.product_id
        cross join store s
        left join commerce.inventory_locations l on l.is_default
        left join commerce.inventory_levels il
          on il.variant_id = ci.variant_id and il.location_id = l.id
        where ci.cart_id = p_cart
      )
      select jsonb_build_object(
        'id', c.id,
        'token', c.token,
        'status', c.status,
        'currency_code', c.currency_code,
        'email', c.email,
        'shipping_address', c.shipping_address,
        'prices_include_tax', (select prices_include_tax from store),
        'item_count', coalesce((select sum(quantity) from line), 0),
        'subtotal_cents', coalesce((
          select sum(case when inclusive then gross_cents - tax_cents else gross_cents end)
          from line
        ), 0)::text,
        'tax_cents', coalesce((select sum(tax_cents) from line), 0)::text,
        'total_cents', coalesce((
          select sum(case when inclusive then gross_cents else gross_cents + tax_cents end)
          from line
        ), 0)::text,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', l.id,
            'variant_id', l.variant_id,
            'product_id', l.product_id,
            'product_title', l.product_title,
            'variant_title', l.variant_title,
            'sku', l.sku,
            'quantity', l.quantity,
            'unit_price_cents', l.unit_price_cents::text,
            'unit_compare_at_cents', l.compare_at_price_cents::text,
            'line_total_cents', (case when l.inclusive then l.gross_cents
                                      else l.gross_cents + l.tax_cents end)::text,
            'tax_cents', l.tax_cents::text,
            'available', l.available
          ) order by l.created_at)
          from line l
        ), '[]'::jsonb)
      )
      from commerce.carts c
      where c.id = p_cart
    $$;

    drop function if exists commerce.cart_apply_discount(text, text);
    drop function if exists commerce.cart_remove_discount(text);
    drop function if exists commerce.discount_by_code(text);
    drop function if exists commerce.assert_discount_valid(commerce.discounts);
    drop function if exists commerce.discount_amount(commerce.discounts, bigint);

    alter table commerce.carts drop column if exists discount_id;
    alter table commerce.orders drop column if exists discount_code;

    drop table if exists commerce.discounts;
    drop type if exists commerce.discount_type;
  `)
    .execute(db);
}
