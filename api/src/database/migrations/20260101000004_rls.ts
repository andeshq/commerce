import { sql, type Kysely } from "kysely";

/**
 * Schema usage, grants and RLS policies for the catalog.
 *
 *   web_anon     - read active products and their children; read store settings
 *   web_customer - web_anon today (own cart/orders later)
 *   web_staff    - full catalog read/write
 *   web_admin    - staff, plus store settings
 *
 * `current_user` is the impersonated Postgres role (pgbase runs SET LOCAL ROLE).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    grant usage on schema commerce to web_anon, web_customer, web_staff, web_admin;
    grant usage on schema auth to web_admin;
  `).execute(db);

  await sql.raw(`
    create or replace function commerce.is_staff() returns boolean
      language sql stable as $$
        select current_user in ('web_staff', 'web_admin')
      $$;
    create or replace function commerce.is_admin() returns boolean
      language sql stable as $$
        select current_user = 'web_admin'
      $$;
    grant execute on function commerce.is_staff() to web_anon, web_customer, web_staff, web_admin;
    grant execute on function commerce.is_admin() to web_anon, web_customer, web_staff, web_admin;
  `).execute(db);

  const catalogTables = [
    "products",
    "product_variants",
    "product_options",
    "product_option_values",
    "collections",
    "product_collections",
    "categories",
    "media",
    "product_media",
    "variant_media",
    "variant_option_values",
    "inventory_locations",
    "inventory_levels",
    "inventory_movements",
  ];

  for (const table of catalogTables) {
    await sql.raw(`
      grant select, insert, update, delete on commerce.${table} to web_staff, web_admin;
    `).execute(db);
  }

  await sql.raw(`
    grant select on commerce.products, commerce.product_variants, commerce.product_options,
      commerce.product_option_values, commerce.collections, commerce.product_collections,
      commerce.categories, commerce.media, commerce.product_media, commerce.variant_media,
      commerce.variant_option_values, commerce.inventory_locations, commerce.inventory_levels
      to web_anon, web_customer;

    grant usage on type commerce.product_status to web_anon, web_customer, web_staff, web_admin;
    grant usage on type commerce.collection_type to web_anon, web_customer, web_staff, web_admin;

    grant select on commerce.store_settings to web_anon, web_customer, web_staff, web_admin;
    grant insert, update on commerce.store_settings to web_admin;
  `).execute(db);

  for (const table of catalogTables) {
    await sql.raw(`alter table commerce.${table} enable row level security;`).execute(db);
  }
  await sql.raw(`alter table commerce.store_settings enable row level security;`).execute(db);

  await sql.raw(`
    create policy products_read on commerce.products
      for select using (status = 'active' or commerce.is_staff());
    create policy products_write on commerce.products
      for all using (commerce.is_staff()) with check (commerce.is_staff());

    create policy store_settings_read on commerce.store_settings
      for select using (true);
    create policy store_settings_write on commerce.store_settings
      for all using (commerce.is_admin()) with check (commerce.is_admin());
  `).execute(db);

  const productChildren = [
    "product_variants",
    "product_options",
    "product_media",
  ];

  for (const table of productChildren) {
    await sql.raw(`
      create policy ${table}_read on commerce.${table}
        for select using (
          commerce.is_staff() or exists (
            select 1 from commerce.products p
            where p.id = ${table}.product_id and p.status = 'active'
          )
        );
      create policy ${table}_write on commerce.${table}
        for all using (commerce.is_staff()) with check (commerce.is_staff());
    `).execute(db);
  }

  await sql.raw(`
    create policy product_option_values_read on commerce.product_option_values
      for select using (
        commerce.is_staff() or exists (
          select 1 from commerce.product_options po
          join commerce.products p on p.id = po.product_id
          where po.id = product_option_values.option_id and p.status = 'active'
        )
      );
    create policy product_option_values_write on commerce.product_option_values
      for all using (commerce.is_staff()) with check (commerce.is_staff());

    create policy variant_media_read on commerce.variant_media
      for select using (
        commerce.is_staff() or exists (
          select 1 from commerce.product_variants v
          join commerce.products p on p.id = v.product_id
          where v.id = variant_media.variant_id and p.status = 'active'
        )
      );
    create policy variant_media_write on commerce.variant_media
      for all using (commerce.is_staff()) with check (commerce.is_staff());

    create policy variant_option_values_read on commerce.variant_option_values
      for select using (
        commerce.is_staff() or exists (
          select 1 from commerce.product_variants v
          join commerce.products p on p.id = v.product_id
          where v.id = variant_option_values.variant_id and p.status = 'active'
        )
      );
    create policy variant_option_values_write on commerce.variant_option_values
      for all using (commerce.is_staff()) with check (commerce.is_staff());
  `).execute(db);

  for (const table of ["collections", "categories", "media"]) {
    await sql.raw(`
      create policy ${table}_read on commerce.${table} for select using (true);
      create policy ${table}_write on commerce.${table}
        for all using (commerce.is_staff()) with check (commerce.is_staff());
    `).execute(db);
  }

  await sql.raw(`
    create policy product_collections_read on commerce.product_collections
      for select using (
        commerce.is_staff() or exists (
          select 1 from commerce.products p
          where p.id = product_collections.product_id and p.status = 'active'
        )
      );
    create policy product_collections_write on commerce.product_collections
      for all using (commerce.is_staff()) with check (commerce.is_staff());
  `).execute(db);

  for (const table of ["inventory_locations", "inventory_levels", "inventory_movements"]) {
    await sql.raw(`
      create policy ${table}_staff on commerce.${table}
        for all using (commerce.is_staff()) with check (commerce.is_staff());
    `).execute(db);
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  // Policies depend on the predicate functions, so they must go first.
  // (Tables are dropped later by the catalog migration's `down`, which would
  // also remove policies — but the functions would already fail to drop.)
  await sql.raw(`
    drop function if exists commerce.is_admin() cascade;
    drop function if exists commerce.is_staff() cascade;
  `).execute(db);
}
