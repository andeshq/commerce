import { sql, type Kysely } from "kysely";

/**
 * Inventory adjustments move into the database. `commerce.adjust_inventory`
 * owns the level+movement transaction, types the reason as an enum, reads the
 * actor from the request context (`request.jwt.claim.sub`), and becomes the
 * only write path: direct DML on levels and movements is revoked from staff.
 *
 * The function is SECURITY DEFINER (callers cannot write the tables), so it
 * checks the impersonated role itself and pins `search_path`.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    create type commerce.inventory_reason as enum (
      'stock_received', 'inventory_recount', 'damage', 'theft', 'loss', 'restock_return'
    );

    grant usage on type commerce.inventory_reason
      to web_anon, web_customer, web_staff, web_admin;

    alter table commerce.inventory_movements
      alter column reason type commerce.inventory_reason
        using reason::commerce.inventory_reason;

    alter table commerce.inventory_movements
      add column created_by text references auth."user" (id) on delete set null,
      add column created_by_name text;

    create trigger inventory_levels_updated_at
      before update on commerce.inventory_levels
      for each row execute function commerce.set_updated_at();
  `).execute(db);

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
      v_reason commerce.inventory_reason := reason;
      v_location_name text;
      v_location_active boolean;
      v_current integer;
      v_delta integer;
      v_available integer;
      v_actor text;
      v_actor_name text;
      v_movement_id uuid;
    begin
      -- SECURITY DEFINER bypasses grants and RLS, so authorize explicitly.
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
      from commerce.inventory_locations l
      where l.id = location;
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
        when v_reason = 'inventory_recount' then quantity - v_current
        when v_reason in ('stock_received', 'restock_return') then quantity
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
        variant,
        location,
        v_delta,
        v_reason,
        case
          when note is null or note = '' then '{}'::jsonb
          else jsonb_build_object('note', note)
        end,
        v_actor,
        v_actor_name
      )
      returning id into v_movement_id;

      return query select v_available, v_movement_id, v_delta;
    end;
    $$;

    revoke all on function commerce.adjust_inventory(
      uuid, uuid, commerce.inventory_reason, integer, text
    ) from public;
    grant execute on function commerce.adjust_inventory(
      uuid, uuid, commerce.inventory_reason, integer, text
    ) to web_staff, web_admin;

    -- The function is the only write path for stock.
    revoke insert, update, delete on commerce.inventory_levels from web_staff, web_admin;
    revoke insert, update, delete on commerce.inventory_movements from web_staff, web_admin;
  `).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    grant insert, update, delete on commerce.inventory_levels to web_staff, web_admin;
    grant insert, update, delete on commerce.inventory_movements to web_staff, web_admin;

    drop function if exists commerce.adjust_inventory(
      uuid, uuid, commerce.inventory_reason, integer, text
    );

    drop trigger if exists inventory_levels_updated_at on commerce.inventory_levels;

    alter table commerce.inventory_movements
      drop column if exists created_by,
      drop column if exists created_by_name;

    alter table commerce.inventory_movements
      alter column reason type text using reason::text;

    drop type if exists commerce.inventory_reason;
  `).execute(db);
}
