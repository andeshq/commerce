import { sql, type Kysely } from "kysely";

/**
 * Modifiers: store-scoped groups of priced add-ons ("Sin cebolla", "Bordado
 * +$10.000") that products can attach and customers pick at checkout. Separate
 * from options/variants: options define the sellable SKU, modifiers adjust it.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    create type commerce.modifier_selection as enum ('single', 'multiple');

    create table commerce.modifier_groups (
      id uuid primary key default gen_random_uuid(),
      name text not null unique,
      selection_type commerce.modifier_selection not null default 'multiple',
      required boolean not null default false,
      position integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create trigger modifier_groups_updated_at
      before update on commerce.modifier_groups
      for each row execute function commerce.set_updated_at();

    create table commerce.modifier_values (
      id uuid primary key default gen_random_uuid(),
      group_id uuid not null references commerce.modifier_groups (id) on delete cascade,
      name text not null,
      price_delta_cents bigint not null default 0,
      position integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index modifier_values_group_id_idx on commerce.modifier_values (group_id);

    create trigger modifier_values_updated_at
      before update on commerce.modifier_values
      for each row execute function commerce.set_updated_at();

    create table commerce.product_modifier_groups (
      product_id uuid not null references commerce.products (id) on delete cascade,
      group_id uuid not null references commerce.modifier_groups (id) on delete restrict,
      position integer not null default 0,
      primary key (product_id, group_id)
    );

    create index product_modifier_groups_group_id_idx on commerce.product_modifier_groups (group_id);

    grant select, insert, update, delete on commerce.modifier_groups,
      commerce.modifier_values, commerce.product_modifier_groups to web_staff, web_admin;
    grant select on commerce.modifier_groups, commerce.modifier_values,
      commerce.product_modifier_groups to web_anon, web_customer;
    grant usage on type commerce.modifier_selection
      to web_anon, web_customer, web_staff, web_admin;

    alter table commerce.modifier_groups enable row level security;
    alter table commerce.modifier_values enable row level security;
    alter table commerce.product_modifier_groups enable row level security;

    create policy modifier_groups_read on commerce.modifier_groups
      for select using (true);
    create policy modifier_groups_write on commerce.modifier_groups
      for all using (commerce.is_staff()) with check (commerce.is_staff());

    create policy modifier_values_read on commerce.modifier_values
      for select using (true);
    create policy modifier_values_write on commerce.modifier_values
      for all using (commerce.is_staff()) with check (commerce.is_staff());

    create policy product_modifier_groups_read on commerce.product_modifier_groups
      for select using (
        commerce.is_staff() or exists (
          select 1 from commerce.products p
          where p.id = product_modifier_groups.product_id and p.status = 'active'
        )
      );
    create policy product_modifier_groups_write on commerce.product_modifier_groups
      for all using (commerce.is_staff()) with check (commerce.is_staff());
  `).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    drop table if exists commerce.product_modifier_groups;
    drop table if exists commerce.modifier_values;
    drop table if exists commerce.modifier_groups;
    drop type if exists commerce.modifier_selection;
  `).execute(db);
}
