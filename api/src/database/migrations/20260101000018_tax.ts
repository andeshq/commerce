import { sql, type Kysely } from "kysely";

/**
 * Tax.
 *
 *  - `store_settings.tax_rate_bps` (+ `tax_label`) is the store's default rate,
 *    in basis points (1900 = 19%). `product_variants.tax_rate_bps` overrides it
 *    per variant; `product_variants.taxable = false` forces 0%.
 *  - `prices_include_tax` decides whether catalog prices already contain tax.
 *  - `order_items.tax_rate_bps` snapshots the rate so historical orders (and,
 *    later, invoices) never move.
 *  - `effective_tax_rate_bps(variant)` is the single rate resolver used by both
 *    `cart_payload` (estimate) and `checkout` (snapshot).
 *
 * Rule: `subtotal_cents` is the tax-exclusive base, `tax_cents` the tax, and
 * `total_cents = subtotal + tax`. Shipping and discounts are 0 for now.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    alter table commerce.store_settings
      add column tax_rate_bps integer not null default 0,
      add column tax_label text not null default 'Tax',
      add constraint store_settings_tax_rate_range
        check (tax_rate_bps between 0 and 10000);

    alter table commerce.product_variants
      add column tax_rate_bps integer,
      add constraint product_variants_tax_rate_range
        check (tax_rate_bps is null or tax_rate_bps between 0 and 10000);

    alter table commerce.order_items
      add column tax_rate_bps integer not null default 0;
  `).execute(db);

  await sql.raw(`
    create or replace function commerce.effective_tax_rate_bps(variant uuid)
      returns integer
      language sql stable security definer set search_path = ''
    as $$
      select coalesce((
        select case
          when v.taxable then coalesce(
            v.tax_rate_bps,
            (select s.tax_rate_bps from commerce.store_settings s limit 1)
          )
          else 0
        end
        from commerce.product_variants v
        where v.id = variant
      ), 0)
    $$;
    revoke all on function commerce.effective_tax_rate_bps(uuid) from public;
  `).execute(db);

  await sql.raw(`
    drop view if exists commerce.catalog_variants;
    create view commerce.catalog_variants
    with (security_invoker = true)
    as
    select
      v.id,
      v.product_id,
      v.title,
      v.sku,
      v.barcode,
      v.position,
      v.price_cents::text as price_cents,
      v.compare_at_price_cents::text as compare_at_price_cents,
      v.weight_grams,
      v.requires_shipping,
      v.taxable,
      v.tax_rate_bps,
      p.title as product_title,
      p.slug as product_slug,
      p.status as product_status,
      p.vendor,
      p.category_id
    from commerce.product_variants v
    join commerce.products p on p.id = v.product_id;

    grant select on commerce.catalog_variants to web_anon, web_customer, web_staff, web_admin;
  `).execute(db);

  await sql.raw(`
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
  `).execute(db);

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
  `).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // Restore the pre-tax cart/checkout first so the columns become droppable.
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
      v_provider text;
      v_actor text := commerce.current_user_id();
      v_email text;
      v_order_id uuid;
      v_number bigint;
      v_access text;
      v_subtotal bigint := 0;
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

      select currency_code into v_currency from commerce.store_settings limit 1;
      select provider into v_provider
        from commerce.payment_providers where enabled order by provider limit 1;
      v_provider := coalesce(v_provider, 'fake');

      for v_item in
        select ci.quantity, v.price_cents, p.status
        from commerce.cart_items ci
        join commerce.product_variants v on v.id = ci.variant_id
        join commerce.products p on p.id = v.product_id
        where ci.cart_id = v_cart.id
      loop
        if v_item.status <> 'active' then
          raise exception 'An item in the cart is no longer available.' using errcode = 'P0001';
        end if;
        v_subtotal := v_subtotal + (v_item.quantity * v_item.price_cents);
      end loop;

      insert into commerce.orders (
        customer_id, email, currency_code, subtotal_cents, total_cents,
        shipping_address, billing_address, note, idempotency_key
      ) values (
        v_actor, v_email, v_currency, v_subtotal, v_subtotal,
        coalesce(p_shipping_address, v_cart.shipping_address),
        p_billing_address, nullif(trim(p_note), ''), nullif(p_idempotency_key, '')
      )
      returning commerce.orders.id, commerce.orders.number, commerce.orders.access_token
        into v_order_id, v_number, v_access;

      for v_item in
        select ci.variant_id, ci.quantity, v.price_cents, v.compare_at_price_cents,
               v.title as variant_title, v.sku, p.title as product_title, p.id as product_id
        from commerce.cart_items ci
        join commerce.product_variants v on v.id = ci.variant_id
        join commerce.products p on p.id = v.product_id
        where ci.cart_id = v_cart.id
        order by ci.created_at
      loop
        insert into commerce.order_items (
          order_id, variant_id, product_id, product_title, variant_title, sku,
          quantity, unit_price_cents, unit_compare_at_cents, total_cents
        ) values (
          v_order_id, v_item.variant_id, v_item.product_id, v_item.product_title,
          v_item.variant_title, v_item.sku, v_item.quantity, v_item.price_cents,
          v_item.compare_at_price_cents, v_item.quantity * v_item.price_cents
        );

        perform commerce.apply_inventory_movement(
          v_item.variant_id, v_location, -(v_item.quantity), 'order_placed',
          v_order_id::text, jsonb_build_object('order_number', v_number), null, null
        );
      end loop;

      insert into commerce.payments (order_id, provider, status, amount_cents, currency_code)
      values (v_order_id, v_provider, 'pending', v_subtotal, v_currency);

      insert into commerce.order_events (order_id, type, data, actor_id)
      values (
        v_order_id, 'placed',
        jsonb_build_object('total_cents', v_subtotal::text,
          'items', (select count(*) from commerce.order_items
                    where commerce.order_items.order_id = v_order_id)),
        v_actor
      );

      update commerce.carts
        set status = 'converted', converted_order_id = v_order_id, converted_at = now()
        where id = v_cart.id;

      return query select v_order_id, v_number, v_access, v_subtotal;
    end;
    $$;

    create or replace function commerce.cart_payload(p_cart uuid) returns jsonb
      language sql stable security definer set search_path = ''
    as $$
      select jsonb_build_object(
        'id', c.id,
        'token', c.token,
        'status', c.status,
        'currency_code', c.currency_code,
        'email', c.email,
        'shipping_address', c.shipping_address,
        'item_count', coalesce((
          select sum(ci.quantity) from commerce.cart_items ci where ci.cart_id = c.id
        ), 0),
        'subtotal_cents', coalesce((
          select sum(ci.quantity * v.price_cents)
          from commerce.cart_items ci
          join commerce.product_variants v on v.id = ci.variant_id
          where ci.cart_id = c.id
        ), 0)::text,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', ci.id,
            'variant_id', ci.variant_id,
            'product_id', v.product_id,
            'product_title', p.title,
            'variant_title', v.title,
            'sku', v.sku,
            'quantity', ci.quantity,
            'unit_price_cents', v.price_cents::text,
            'unit_compare_at_cents', v.compare_at_price_cents::text,
            'line_total_cents', (ci.quantity * v.price_cents)::text,
            'available', coalesce(il.available, 0)
          ) order by ci.created_at)
          from commerce.cart_items ci
          join commerce.product_variants v on v.id = ci.variant_id
          join commerce.products p on p.id = v.product_id
          left join commerce.inventory_locations l on l.is_default
          left join commerce.inventory_levels il
            on il.variant_id = ci.variant_id and il.location_id = l.id
          where ci.cart_id = c.id
        ), '[]'::jsonb)
      )
      from commerce.carts c
      where c.id = p_cart
    $$;

    drop view if exists commerce.catalog_variants;
    create view commerce.catalog_variants
    with (security_invoker = true)
    as
    select
      v.id, v.product_id, v.title, v.sku, v.barcode, v.position,
      v.price_cents::text as price_cents,
      v.compare_at_price_cents::text as compare_at_price_cents,
      v.weight_grams, v.requires_shipping, v.taxable,
      p.title as product_title, p.slug as product_slug,
      p.status as product_status, p.vendor, p.category_id
    from commerce.product_variants v
    join commerce.products p on p.id = v.product_id;
    grant select on commerce.catalog_variants to web_anon, web_customer, web_staff, web_admin;

    drop function if exists commerce.effective_tax_rate_bps(uuid);

    alter table commerce.order_items drop column if exists tax_rate_bps;
    alter table commerce.product_variants drop column if exists tax_rate_bps;
    alter table commerce.store_settings
      drop column if exists tax_rate_bps,
      drop column if exists tax_label;
  `).execute(db);
}
