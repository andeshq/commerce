import { sql, type Kysely } from "kysely";

/**
 * `commerce.checkout` turns an open cart into an order in one transaction:
 * re-validate the catalog, snapshot prices, decrement stock at the default
 * location through the shared ledger, and open a pending payment. Idempotent on
 * `idempotency_key`, so a client retry returns the same order.
 *
 * `order_get` lets the token holder read the order (guests have no session).
 */
export async function up(db: Kysely<any>): Promise<void> {
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
      -- Idempotent retry: return the order created by the first call.
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

      -- One pass: validate status and sum the subtotal.
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

      -- Snapshot the lines and take the stock.
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
      values (v_order_id, v_provider, 'pending', v_subtotal, v_currency);

      insert into commerce.order_events (order_id, type, data, actor_id)
      values (
        v_order_id, 'placed',
        jsonb_build_object(
          'total_cents', v_subtotal::text,
          'items', (select count(*) from commerce.order_items
                    where commerce.order_items.order_id = v_order_id)
        ),
        v_actor
      );

      update commerce.carts
        set status = 'converted', converted_order_id = v_order_id, converted_at = now()
        where id = v_cart.id;

      return query select v_order_id, v_number, v_access, v_subtotal;
    end;
    $$;

    create or replace function commerce.order_get(p_token text) returns jsonb
      language plpgsql security definer set search_path = ''
    as $$
    declare
      v_order commerce.orders;
    begin
      select * into v_order from commerce.orders where access_token = p_token;
      if not found then
        raise exception 'Order not found.' using errcode = 'P0001';
      end if;

      return jsonb_build_object(
        'id', v_order.id,
        'number', v_order.number,
        'email', v_order.email,
        'status', v_order.status,
        'payment_status', v_order.payment_status,
        'fulfillment_status', v_order.fulfillment_status,
        'currency_code', v_order.currency_code,
        'subtotal_cents', v_order.subtotal_cents::text,
        'discount_cents', v_order.discount_cents::text,
        'tax_cents', v_order.tax_cents::text,
        'shipping_cents', v_order.shipping_cents::text,
        'total_cents', v_order.total_cents::text,
        'shipping_address', v_order.shipping_address,
        'billing_address', v_order.billing_address,
        'note', v_order.note,
        'placed_at', v_order.placed_at,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'product_title', oi.product_title,
            'variant_title', oi.variant_title,
            'sku', oi.sku,
            'quantity', oi.quantity,
            'unit_price_cents', oi.unit_price_cents::text,
            'total_cents', oi.total_cents::text
          ) order by oi.created_at)
          from commerce.order_items oi where oi.order_id = v_order.id
        ), '[]'::jsonb),
        'payments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'provider', pm.provider,
            'method', pm.method,
            'status', pm.status,
            'amount_cents', pm.amount_cents::text,
            'provider_ref', pm.provider_ref
          ) order by pm.created_at)
          from commerce.payments pm where pm.order_id = v_order.id
        ), '[]'::jsonb)
      );
    end;
    $$;

    grant execute on function commerce.checkout(text, text, jsonb, jsonb, text, text)
      to web_anon, web_customer, web_staff, web_admin;
    grant execute on function commerce.order_get(text)
      to web_anon, web_customer, web_staff, web_admin;
  `).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    drop function if exists commerce.order_get(text);
    drop function if exists commerce.checkout(text, text, jsonb, jsonb, text, text);
  `).execute(db);
}
