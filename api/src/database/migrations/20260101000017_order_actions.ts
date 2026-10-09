import { sql, type Kysely } from "kysely";

/**
 * Staff order lifecycle, exposed over pgbase RPC. Marking paid is the offline
 * path (cash/transfer) for orders not driven by a gateway webhook; cancel
 * returns stock through the shared ledger. All three record an `order_event`
 * with the actor.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    create or replace function commerce.order_mark_paid(order_uuid uuid)
      returns void
      language plpgsql security definer set search_path = ''
    as $$
    declare
      v_role text := current_setting('role', true);
      v_order commerce.orders;
      v_actor text;
      v_actor_name text;
    begin
      if v_role is null or v_role not in ('web_staff', 'web_admin') then
        raise exception 'Staff access required.' using errcode = '42501';
      end if;

      select * into v_order from commerce.orders where id = order_uuid;
      if not found then
        raise exception 'Order not found.' using errcode = 'P0001';
      end if;
      if v_order.payment_status = 'paid' then
        return;
      end if;

      update commerce.payments
        set status = 'paid'
        where id = (
          select id from commerce.payments
          where order_id = order_uuid and status in ('pending', 'failed', 'authorized')
          order by created_at desc limit 1
        );

      update commerce.orders set payment_status = 'paid' where id = order_uuid;

      select nullif(current_setting('request.jwt.claim.sub', true), '') into v_actor;
      if v_actor is not null then
        select u.name into v_actor_name from auth."user" u where u.id = v_actor;
      end if;

      insert into commerce.order_events (order_id, type, data, actor_id, actor_name)
      values (order_uuid, 'payment',
        jsonb_build_object('status', 'paid', 'manual', true), v_actor, v_actor_name);
    end;
    $$;

    create or replace function commerce.order_fulfill(order_uuid uuid)
      returns void
      language plpgsql security definer set search_path = ''
    as $$
    declare
      v_role text := current_setting('role', true);
      v_order commerce.orders;
      v_actor text;
      v_actor_name text;
    begin
      if v_role is null or v_role not in ('web_staff', 'web_admin') then
        raise exception 'Staff access required.' using errcode = '42501';
      end if;

      select * into v_order from commerce.orders where id = order_uuid;
      if not found then
        raise exception 'Order not found.' using errcode = 'P0001';
      end if;
      if v_order.status = 'cancelled' then
        raise exception 'A cancelled order cannot be fulfilled.' using errcode = 'P0001';
      end if;

      update commerce.orders
        set fulfillment_status = 'fulfilled', status = 'completed'
        where id = order_uuid;

      select nullif(current_setting('request.jwt.claim.sub', true), '') into v_actor;
      if v_actor is not null then
        select u.name into v_actor_name from auth."user" u where u.id = v_actor;
      end if;

      insert into commerce.order_events (order_id, type, data, actor_id, actor_name)
      values (order_uuid, 'fulfilled', '{}'::jsonb, v_actor, v_actor_name);
    end;
    $$;

    create or replace function commerce.order_cancel(order_uuid uuid)
      returns void
      language plpgsql security definer set search_path = ''
    as $$
    declare
      v_role text := current_setting('role', true);
      v_order commerce.orders;
      v_location uuid;
      v_item record;
      v_actor text;
      v_actor_name text;
    begin
      if v_role is null or v_role not in ('web_staff', 'web_admin') then
        raise exception 'Staff access required.' using errcode = '42501';
      end if;

      select * into v_order from commerce.orders where id = order_uuid;
      if not found then
        raise exception 'Order not found.' using errcode = 'P0001';
      end if;
      if v_order.status = 'cancelled' then
        return;
      end if;

      v_location := commerce.default_location();
      if v_location is null then
        raise exception 'No fulfillment location is configured.' using errcode = 'P0001';
      end if;

      select nullif(current_setting('request.jwt.claim.sub', true), '') into v_actor;
      if v_actor is not null then
        select u.name into v_actor_name from auth."user" u where u.id = v_actor;
      end if;

      for v_item in
        select variant_id, quantity from commerce.order_items
        where order_id = order_uuid and variant_id is not null
      loop
        perform commerce.apply_inventory_movement(
          v_item.variant_id,
          v_location,
          v_item.quantity,
          'order_cancelled',
          order_uuid::text,
          jsonb_build_object('order_number', v_order.number),
          v_actor,
          v_actor_name
        );
      end loop;

      update commerce.orders set status = 'cancelled' where id = order_uuid;

      insert into commerce.order_events (order_id, type, data, actor_id, actor_name)
      values (order_uuid, 'cancelled', '{}'::jsonb, v_actor, v_actor_name);
    end;
    $$;

    revoke all on function commerce.order_mark_paid(uuid) from public;
    revoke all on function commerce.order_fulfill(uuid) from public;
    revoke all on function commerce.order_cancel(uuid) from public;

    grant execute on function commerce.order_mark_paid(uuid) to web_staff, web_admin;
    grant execute on function commerce.order_fulfill(uuid) to web_staff, web_admin;
    grant execute on function commerce.order_cancel(uuid) to web_staff, web_admin;
  `).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    drop function if exists commerce.order_cancel(uuid);
    drop function if exists commerce.order_fulfill(uuid);
    drop function if exists commerce.order_mark_paid(uuid);
  `).execute(db);
}
