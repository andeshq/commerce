import { sql, type Kysely } from "kysely";

/**
 * Order-lifecycle hardening.
 *
 *  - `expire_stale_orders` cancels unpaid orders older than a cutoff and
 *    restocks them through the shared ledger. It is safe to run from every
 *    replica: a transaction-scoped advisory lock makes it single-runner per
 *    tick, and `for update skip locked` guarantees each order is claimed once.
 *  - `payment_providers` gets a partial unique index so at most one provider is
 *    enabled, making checkout's provider selection unambiguous.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    alter type commerce.inventory_reason add value if not exists 'order_expired';

    create unique index payment_providers_single_enabled
      on commerce.payment_providers (enabled) where enabled;
  `).execute(db);

  await sql.raw(`
    create or replace function commerce.expire_stale_orders(p_before timestamptz)
      returns integer
      language plpgsql security definer set search_path = ''
    as $$
    declare
      v_location uuid;
      v_order record;
      v_item record;
      v_count integer := 0;
    begin
      -- Single runner per tick across replicas; the lock is released at commit.
      if not pg_try_advisory_xact_lock(918273645::bigint) then
        return 0;
      end if;

      v_location := commerce.default_location();
      if v_location is null then
        return 0;
      end if;

      for v_order in
        select id, number from commerce.orders
        where status = 'open'
          and payment_status in ('pending', 'failed')
          and placed_at < p_before
        order by placed_at
        for update skip locked
      loop
        for v_item in
          select variant_id, quantity from commerce.order_items
          where order_id = v_order.id and variant_id is not null
        loop
          perform commerce.apply_inventory_movement(
            v_item.variant_id,
            v_location,
            v_item.quantity,
            'order_expired',
            v_order.id::text,
            jsonb_build_object('order_number', v_order.number),
            null,
            null
          );
        end loop;

        update commerce.orders set status = 'cancelled' where id = v_order.id;

        insert into commerce.order_events (order_id, type, data)
        values (v_order.id, 'expired', jsonb_build_object('reason', 'unpaid_timeout'));

        v_count := v_count + 1;
      end loop;

      return v_count;
    end;
    $$;

    revoke all on function commerce.expire_stale_orders(timestamptz) from public;
    grant execute on function commerce.expire_stale_orders(timestamptz) to web_staff, web_admin;
  `).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    drop function if exists commerce.expire_stale_orders(timestamptz);
    drop index if exists commerce.payment_providers_single_enabled;
  `).execute(db);
}
