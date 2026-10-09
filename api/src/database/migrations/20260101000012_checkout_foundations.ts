import { sql, type Kysely } from "kysely";

/**
 * Checkout foundations.
 *
 *  - `commerce.current_user_id()` reads pgbase's `sub` claim, so policies can
 *    compare `customer_id = commerce.current_user_id()` next to `is_staff()`.
 *  - `inventory_locations.is_default` (at most one, enforced by a partial unique
 *    index) marks where checkout takes stock from; `set_default_location` moves
 *    it atomically under a staff check.
 *  - `apply_inventory_movement` becomes the single stock-writing routine.
 *    `adjust_inventory` now delegates to it, and checkout will call it for
 *    orders. It is internal: `EXECUTE` is revoked from `PUBLIC`/`web_*` so it is
 *    never reachable over pgbase RPC.
 *  - New ledgers reasons for order lifecycle.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    alter type commerce.inventory_reason add value if not exists 'order_placed';
    alter type commerce.inventory_reason add value if not exists 'order_cancelled';
    alter type commerce.inventory_reason add value if not exists 'order_refunded';
  `).execute(db);

  await sql.raw(`
    alter table commerce.inventory_locations
      add column is_default boolean not null default false;

    create unique index inventory_locations_default_key
      on commerce.inventory_locations (is_default) where is_default;

    -- Backfill: the seeded primary store becomes the default when none is set.
    update commerce.inventory_locations
      set is_default = true
      where code = 'MAIN'
        and not exists (select 1 from commerce.inventory_locations where is_default);

    create or replace function commerce.current_user_id() returns text
      language sql stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')
    $$;
    grant execute on function commerce.current_user_id()
      to web_anon, web_customer, web_staff, web_admin;

    create or replace function commerce.set_default_location(location uuid)
      returns void
      language plpgsql security definer set search_path = ''
    as $$
    declare
      v_role text := current_setting('role', true);
    begin
      if v_role is null or v_role not in ('web_staff', 'web_admin') then
        raise exception 'Staff access required.' using errcode = '42501';
      end if;
      if not exists (select 1 from commerce.inventory_locations where id = location) then
        raise exception 'Location not found.' using errcode = 'P0001';
      end if;
      update commerce.inventory_locations
        set is_default = false
        where is_default and id <> location;
      update commerce.inventory_locations
        set is_default = true
        where id = location;
    end;
    $$;
    revoke all on function commerce.set_default_location(uuid) from public;
    grant execute on function commerce.set_default_location(uuid) to web_staff, web_admin;
  `).execute(db);

  // Shared stock writer: level upsert + movement, guarded against negative
  // stock. `change` is the signed delta; the returned `delta` mirrors it.
  await sql.raw(`
    create or replace function commerce.apply_inventory_movement(
      variant uuid,
      location uuid,
      change integer,
      reason commerce.inventory_reason,
      reference text default null,
      metadata jsonb default '{}'::jsonb,
      actor text default null,
      actor_name text default null
    ) returns table (available integer, movement_id uuid, delta integer)
      language plpgsql
      security definer
      set search_path = ''
    as $$
    declare
      v_location_name text;
      v_current integer;
      v_available integer;
      v_movement_id uuid;
    begin
      select l.name into v_location_name
      from commerce.inventory_locations l where l.id = location;
      if not found then
        raise exception 'Location not found.' using errcode = 'P0001';
      end if;

      if not exists (select 1 from commerce.product_variants v where v.id = variant) then
        raise exception 'Variant not found.' using errcode = 'P0001';
      end if;

      select il.available into v_current
      from commerce.inventory_levels il
      where il.variant_id = variant and il.location_id = location
      for update;
      if not found then
        v_current := 0;
      end if;

      v_available := v_current + change;
      if v_available < 0 then
        raise exception 'Only % on hand at %.', v_current, v_location_name
          using errcode = 'P0001';
      end if;

      insert into commerce.inventory_levels (variant_id, location_id, available)
      values (variant, location, v_available)
      on conflict (variant_id, location_id)
      do update set available = excluded.available;

      insert into commerce.inventory_movements
        (variant_id, location_id, delta, reason, reference, metadata, created_by, created_by_name)
      values (variant, location, change, reason, reference, metadata, actor, actor_name)
      returning id into v_movement_id;

      return query select v_available, v_movement_id, change;
    end;
    $$;

    revoke all on function commerce.apply_inventory_movement(
      uuid, uuid, integer, commerce.inventory_reason, text, jsonb, text, text
    ) from public;
  `).execute(db);

  // adjust_inventory keeps its role/active checks and delegates the write.
  await sql.raw(`
    create or replace function commerce.adjust_inventory(
      variant uuid,
      location uuid,
      reason commerce.inventory_reason,
      quantity integer,
      note text default null
    ) returns table (available integer, movement_id uuid, delta integer)
      language plpgsql
      security definer
      set search_path = ''
    as $$
    declare
      v_role text := current_setting('role', true);
      v_location_name text;
      v_location_active boolean;
      v_current integer;
      v_delta integer;
      v_actor text;
      v_actor_name text;
    begin
      if v_role is null or v_role not in ('web_staff', 'web_admin') then
        raise exception 'Staff access required.' using errcode = '42501';
      end if;

      if quantity is null or quantity < 0 or quantity > 1000000 then
        raise exception 'Quantity must be between 0 and 1000000.' using errcode = '22023';
      end if;
      if note is not null and length(note) > 300 then
        raise exception 'Notes are limited to 300 characters.' using errcode = '22023';
      end if;

      select l.name, l.active into v_location_name, v_location_active
      from commerce.inventory_locations l where l.id = location;
      if not found then
        raise exception 'Location not found.' using errcode = 'P0001';
      end if;
      if not v_location_active then
        raise exception '% is inactive.', v_location_name using errcode = 'P0001';
      end if;

      select il.available into v_current
      from commerce.inventory_levels il
      where il.variant_id = variant and il.location_id = location
      for update;
      if not found then
        v_current := 0;
      end if;

      v_delta := case
        when reason = 'inventory_recount' then quantity - v_current
        when reason in ('stock_received', 'restock_return') then quantity
        else -quantity
      end;

      if v_delta = 0 then
        raise exception 'That matches the current stock — nothing to record.'
          using errcode = 'P0001';
      end if;

      select nullif(current_setting('request.jwt.claim.sub', true), '') into v_actor;
      if v_actor is not null then
        select u.name into v_actor_name from auth."user" u where u.id = v_actor;
      end if;

      return query
        select h.available, h.movement_id, h.delta
        from commerce.apply_inventory_movement(
          variant,
          location,
          v_delta,
          reason,
          null,
          case
            when note is null or note = '' then '{}'::jsonb
            else jsonb_build_object('note', note)
          end,
          v_actor,
          v_actor_name
        ) h;
    end;
    $$;
  `).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // Enum values cannot be removed in Postgres; the three order reasons stay.
  await sql.raw(`
    create or replace function commerce.adjust_inventory(
      variant uuid,
      location uuid,
      reason commerce.inventory_reason,
      quantity integer,
      note text default null
    ) returns table (available integer, movement_id uuid, delta integer)
      language plpgsql
      security definer
      set search_path = ''
    as $$
    declare
      v_role text := current_setting('role', true);
      v_location_name text;
      v_location_active boolean;
      v_current integer;
      v_delta integer;
      v_available integer;
      v_actor text;
      v_actor_name text;
      v_movement_id uuid;
    begin
      if v_role is null or v_role not in ('web_staff', 'web_admin') then
        raise exception 'Staff access required.' using errcode = '42501';
      end if;

      if quantity is null or quantity < 0 or quantity > 1000000 then
        raise exception 'Quantity must be between 0 and 1000000.' using errcode = '22023';
      end if;
      if note is not null and length(note) > 300 then
        raise exception 'Notes are limited to 300 characters.' using errcode = '22023';
      end if;

      select l.name, l.active into v_location_name, v_location_active
      from commerce.inventory_locations l where l.id = location;
      if not found then
        raise exception 'Location not found.' using errcode = 'P0001';
      end if;
      if not v_location_active then
        raise exception '% is inactive.', v_location_name using errcode = 'P0001';
      end if;

      if not exists (select 1 from commerce.product_variants v where v.id = variant) then
        raise exception 'Variant not found.' using errcode = 'P0001';
      end if;

      select il.available into v_current
      from commerce.inventory_levels il
      where il.variant_id = variant and il.location_id = location
      for update;
      if not found then
        v_current := 0;
      end if;

      v_delta := case
        when reason = 'inventory_recount' then quantity - v_current
        when reason in ('stock_received', 'restock_return') then quantity
        else -quantity
      end;

      if v_delta = 0 then
        raise exception 'That matches the current stock — nothing to record.'
          using errcode = 'P0001';
      end if;

      v_available := v_current + v_delta;
      if v_available < 0 then
        raise exception 'Only % on hand at %.', v_current, v_location_name
          using errcode = 'P0001';
      end if;

      insert into commerce.inventory_levels (variant_id, location_id, available)
      values (variant, location, v_available)
      on conflict (variant_id, location_id)
      do update set available = excluded.available;

      select nullif(current_setting('request.jwt.claim.sub', true), '') into v_actor;
      if v_actor is not null then
        select u.name into v_actor_name from auth."user" u where u.id = v_actor;
      end if;

      insert into commerce.inventory_movements
        (variant_id, location_id, delta, reason, metadata, created_by, created_by_name)
      values (
        variant, location, v_delta, reason,
        case when note is null or note = '' then '{}'::jsonb
             else jsonb_build_object('note', note) end,
        v_actor, v_actor_name
      )
      returning id into v_movement_id;

      return query select v_available, v_movement_id, v_delta;
    end;
    $$;

    drop function if exists commerce.apply_inventory_movement(
      uuid, uuid, integer, commerce.inventory_reason, text, jsonb, text, text
    );
    drop function if exists commerce.set_default_location(uuid);
    drop function if exists commerce.current_user_id();

    drop index if exists commerce.inventory_locations_default_key;
    alter table commerce.inventory_locations drop column if exists is_default;
  `).execute(db);
}
