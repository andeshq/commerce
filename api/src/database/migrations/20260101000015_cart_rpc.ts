import { sql, type Kysely } from "kysely";

/**
 * Guest/session cart API, exposed over pgbase RPC (`/rest/rpc/cart_*`).
 *
 * The cart token is the credential: every function is SECURITY DEFINER (carts
 * carry no grants for `web_*`), validates the token, and returns a rebuilt JSON
 * document with live prices and availability. Helpers are internal — `EXECUTE`
 * is revoked from `PUBLIC` so only these entry points are reachable.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    create or replace function commerce.default_location() returns uuid
      language sql stable security definer set search_path = ''
    as $$
      select id from commerce.inventory_locations where is_default
    $$;

    create or replace function commerce.cart_by_token(p_token text, p_require_open boolean default true)
      returns commerce.carts
      language plpgsql security definer set search_path = ''
    as $$
    declare
      v_cart commerce.carts;
    begin
      select * into v_cart from commerce.carts where token = p_token;
      if not found then
        raise exception 'Cart not found.' using errcode = 'P0001';
      end if;
      if p_require_open and v_cart.status <> 'open' then
        raise exception 'This cart is no longer open.' using errcode = 'P0001';
      end if;
      return v_cart;
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

    create or replace function commerce.cart_create(p_email text default null)
      returns table (id uuid, token text)
      language plpgsql security definer set search_path = ''
    as $$
    declare
      v_currency text;
      v_cart commerce.carts;
    begin
      select currency_code into v_currency from commerce.store_settings limit 1;
      if v_currency is null then
        raise exception 'The store is not configured yet.' using errcode = 'P0001';
      end if;

      insert into commerce.carts (currency_code, customer_id, email)
      values (v_currency, commerce.current_user_id(), nullif(trim(p_email), ''))
      returning * into v_cart;

      return query select v_cart.id, v_cart.token;
    end;
    $$;

    create or replace function commerce.cart_get(p_token text) returns jsonb
      language plpgsql security definer set search_path = ''
    as $$
    declare
      v_cart commerce.carts;
    begin
      v_cart := commerce.cart_by_token(p_token, false);
      return commerce.cart_payload(v_cart.id);
    end;
    $$;

    create or replace function commerce.cart_add_item(
      p_token text,
      p_variant uuid,
      p_quantity integer default 1
    ) returns jsonb
      language plpgsql security definer set search_path = ''
    as $$
    declare
      v_cart commerce.carts;
      v_location uuid;
      v_status commerce.product_status;
      v_available integer;
      v_existing integer;
    begin
      if p_quantity is null or p_quantity < 1 or p_quantity > 1000000 then
        raise exception 'Quantity must be between 1 and 1000000.' using errcode = '22023';
      end if;

      v_cart := commerce.cart_by_token(p_token);

      v_location := commerce.default_location();
      if v_location is null then
        raise exception 'No fulfillment location is configured.' using errcode = 'P0001';
      end if;

      select p.status into v_status
      from commerce.product_variants v
      join commerce.products p on p.id = v.product_id
      where v.id = p_variant;
      if not found then
        raise exception 'Variant not found.' using errcode = 'P0001';
      end if;
      if v_status <> 'active' then
        raise exception 'This item is not available.' using errcode = 'P0001';
      end if;

      select coalesce(available, 0) into v_available
      from commerce.inventory_levels
      where variant_id = p_variant and location_id = v_location;
      v_available := coalesce(v_available, 0);

      select quantity into v_existing
      from commerce.cart_items
      where cart_id = v_cart.id and variant_id = p_variant;
      v_existing := coalesce(v_existing, 0);

      if (v_existing + p_quantity) > v_available then
        raise exception 'Only % available.', v_available using errcode = 'P0001';
      end if;

      insert into commerce.cart_items (cart_id, variant_id, quantity)
      values (v_cart.id, p_variant, p_quantity)
      on conflict (cart_id, variant_id)
      do update set quantity = commerce.cart_items.quantity + excluded.quantity;

      return commerce.cart_payload(v_cart.id);
    end;
    $$;

    create or replace function commerce.cart_update_item(
      p_token text,
      p_item uuid,
      p_quantity integer
    ) returns jsonb
      language plpgsql security definer set search_path = ''
    as $$
    declare
      v_cart commerce.carts;
      v_location uuid;
      v_available integer;
    begin
      if p_quantity is null or p_quantity < 0 or p_quantity > 1000000 then
        raise exception 'Quantity must be between 0 and 1000000.' using errcode = '22023';
      end if;

      v_cart := commerce.cart_by_token(p_token);

      if p_quantity = 0 then
        delete from commerce.cart_items where id = p_item and cart_id = v_cart.id;
        if not found then
          raise exception 'Cart item not found.' using errcode = 'P0001';
        end if;
        return commerce.cart_payload(v_cart.id);
      end if;

      if not exists (
        select 1 from commerce.cart_items where id = p_item and cart_id = v_cart.id
      ) then
        raise exception 'Cart item not found.' using errcode = 'P0001';
      end if;

      v_location := commerce.default_location();
      if v_location is null then
        raise exception 'No fulfillment location is configured.' using errcode = 'P0001';
      end if;

      select coalesce(il.available, 0) into v_available
      from commerce.cart_items ci
      left join commerce.inventory_levels il
        on il.variant_id = ci.variant_id and il.location_id = v_location
      where ci.id = p_item;
      v_available := coalesce(v_available, 0);
      if p_quantity > v_available then
        raise exception 'Only % available.', v_available using errcode = 'P0001';
      end if;

      update commerce.cart_items set quantity = p_quantity where id = p_item;
      return commerce.cart_payload(v_cart.id);
    end;
    $$;

    create or replace function commerce.cart_remove_item(p_token text, p_item uuid)
      returns jsonb
      language plpgsql security definer set search_path = ''
    as $$
    declare
      v_cart commerce.carts;
    begin
      v_cart := commerce.cart_by_token(p_token);
      delete from commerce.cart_items where id = p_item and cart_id = v_cart.id;
      return commerce.cart_payload(v_cart.id);
    end;
    $$;

    create or replace function commerce.cart_set_address(
      p_token text,
      p_email text,
      p_shipping_address jsonb
    ) returns jsonb
      language plpgsql security definer set search_path = ''
    as $$
    declare
      v_cart commerce.carts;
    begin
      v_cart := commerce.cart_by_token(p_token);
      update commerce.carts
        set email = nullif(trim(p_email), ''),
            shipping_address = p_shipping_address
        where id = v_cart.id;
      return commerce.cart_payload(v_cart.id);
    end;
    $$;

    revoke all on function commerce.cart_by_token(text, boolean) from public;
    revoke all on function commerce.cart_payload(uuid) from public;
    revoke all on function commerce.default_location() from public;

    grant execute on function commerce.cart_create(text)
      to web_anon, web_customer, web_staff, web_admin;
    grant execute on function commerce.cart_get(text)
      to web_anon, web_customer, web_staff, web_admin;
    grant execute on function commerce.cart_add_item(text, uuid, integer)
      to web_anon, web_customer, web_staff, web_admin;
    grant execute on function commerce.cart_update_item(text, uuid, integer)
      to web_anon, web_customer, web_staff, web_admin;
    grant execute on function commerce.cart_remove_item(text, uuid)
      to web_anon, web_customer, web_staff, web_admin;
    grant execute on function commerce.cart_set_address(text, text, jsonb)
      to web_anon, web_customer, web_staff, web_admin;
  `).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    drop function if exists commerce.cart_set_address(text, text, jsonb);
    drop function if exists commerce.cart_remove_item(text, uuid);
    drop function if exists commerce.cart_update_item(text, uuid, integer);
    drop function if exists commerce.cart_add_item(text, uuid, integer);
    drop function if exists commerce.cart_get(text);
    drop function if exists commerce.cart_create(text);
    drop function if exists commerce.cart_payload(uuid);
    drop function if exists commerce.cart_by_token(text, boolean);
    drop function if exists commerce.default_location();
  `).execute(db);
}
