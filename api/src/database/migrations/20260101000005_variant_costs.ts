import { sql, type Kysely } from "kysely";

/**
 * Move unit cost (COGS) off `product_variants` into a staff-only table.
 *
 * pgbase expands `select=*` to every introspected column, so a sensitive column
 * on a publicly readable table cannot be hidden with column-level grants
 * without breaking `select=*`. Keeping cost in its own relation makes the
 * public variant shape safe by construction.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    create table commerce.product_variant_costs (
      variant_id uuid primary key references commerce.product_variants (id) on delete cascade,
      cost_cents bigint not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint product_variant_costs_non_negative check (cost_cents >= 0)
    );

    create trigger product_variant_costs_updated_at
      before update on commerce.product_variant_costs
      for each row execute function commerce.set_updated_at();

    alter table commerce.product_variants drop column cost_cents;

    grant select, insert, update, delete on commerce.product_variant_costs
      to web_staff, web_admin;

    alter table commerce.product_variant_costs enable row level security;

    create policy product_variant_costs_staff on commerce.product_variant_costs
      for all using (commerce.is_staff()) with check (commerce.is_staff());
  `).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    alter table commerce.product_variants add column cost_cents bigint;
    drop table if exists commerce.product_variant_costs;
  `).execute(db);
}
