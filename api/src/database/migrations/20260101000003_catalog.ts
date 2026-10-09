import { sql, type Kysely } from "kysely";

/**
 * Catalog primitives and store settings, in schema `commerce`.
 *
 * Structure only: grants and RLS live in the next migration. Store settings
 * rows and the first admin are created at first-run setup.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    create table commerce.store_settings (
      id boolean primary key default true,
      name text not null,
      currency_code text not null,
      locale text not null,
      prices_include_tax boolean not null,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint store_settings_singleton check (id)
    );

    create trigger store_settings_updated_at
      before update on commerce.store_settings
      for each row execute function commerce.set_updated_at();

    create table commerce.media (
      id uuid primary key default gen_random_uuid(),
      url text not null,
      alt text,
      content_type text,
      width integer,
      height integer,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create trigger media_updated_at
      before update on commerce.media
      for each row execute function commerce.set_updated_at();

    create table commerce.categories (
      id uuid primary key default gen_random_uuid(),
      parent_id uuid references commerce.categories (id) on delete set null,
      name text not null,
      slug text not null unique,
      description text,
      position integer not null default 0,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index categories_parent_id_idx on commerce.categories (parent_id);

    create trigger categories_updated_at
      before update on commerce.categories
      for each row execute function commerce.set_updated_at();

    create type commerce.collection_type as enum ('manual', 'smart');

    create table commerce.collections (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      slug text not null unique,
      description text,
      type commerce.collection_type not null default 'manual',
      rules jsonb not null default '[]'::jsonb,
      position integer not null default 0,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create trigger collections_updated_at
      before update on commerce.collections
      for each row execute function commerce.set_updated_at();

    create type commerce.product_status as enum ('draft', 'active', 'archived');

    create table commerce.products (
      id uuid primary key default gen_random_uuid(),
      title text not null,
      slug text not null unique,
      description text,
      status commerce.product_status not null default 'draft',
      vendor text,
      product_type text,
      category_id uuid references commerce.categories (id) on delete set null,
      published_at timestamptz,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index products_status_idx on commerce.products (status);
    create index products_category_id_idx on commerce.products (category_id);

    create trigger products_updated_at
      before update on commerce.products
      for each row execute function commerce.set_updated_at();

    create table commerce.product_collections (
      product_id uuid not null references commerce.products (id) on delete cascade,
      collection_id uuid not null references commerce.collections (id) on delete cascade,
      position integer not null default 0,
      primary key (product_id, collection_id)
    );

    create index product_collections_collection_id_idx
      on commerce.product_collections (collection_id);

    create table commerce.product_options (
      id uuid primary key default gen_random_uuid(),
      product_id uuid not null references commerce.products (id) on delete cascade,
      name text not null,
      position integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (product_id, name)
    );

    create index product_options_product_id_idx on commerce.product_options (product_id);

    create trigger product_options_updated_at
      before update on commerce.product_options
      for each row execute function commerce.set_updated_at();

    create table commerce.product_option_values (
      id uuid primary key default gen_random_uuid(),
      option_id uuid not null references commerce.product_options (id) on delete cascade,
      value text not null,
      position integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (option_id, value)
    );

    create index product_option_values_option_id_idx
      on commerce.product_option_values (option_id);

    create trigger product_option_values_updated_at
      before update on commerce.product_option_values
      for each row execute function commerce.set_updated_at();

    create table commerce.product_variants (
      id uuid primary key default gen_random_uuid(),
      product_id uuid not null references commerce.products (id) on delete cascade,
      sku text unique,
      barcode text,
      title text not null default 'Default',
      position integer not null default 0,
      price_cents bigint not null default 0,
      compare_at_price_cents bigint,
      cost_cents bigint,
      weight_grams integer,
      requires_shipping boolean not null default true,
      taxable boolean not null default true,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint product_variants_price_non_negative check (price_cents >= 0)
    );

    create index product_variants_product_id_idx on commerce.product_variants (product_id);

    create trigger product_variants_updated_at
      before update on commerce.product_variants
      for each row execute function commerce.set_updated_at();

    create table commerce.variant_option_values (
      variant_id uuid not null references commerce.product_variants (id) on delete cascade,
      option_value_id uuid not null references commerce.product_option_values (id) on delete cascade,
      primary key (variant_id, option_value_id)
    );

    create index variant_option_values_option_value_id_idx
      on commerce.variant_option_values (option_value_id);

    create table commerce.product_media (
      product_id uuid not null references commerce.products (id) on delete cascade,
      media_id uuid not null references commerce.media (id) on delete cascade,
      position integer not null default 0,
      primary key (product_id, media_id)
    );

    create index product_media_media_id_idx on commerce.product_media (media_id);

    create table commerce.variant_media (
      variant_id uuid not null references commerce.product_variants (id) on delete cascade,
      media_id uuid not null references commerce.media (id) on delete cascade,
      position integer not null default 0,
      primary key (variant_id, media_id)
    );

    create index variant_media_media_id_idx on commerce.variant_media (media_id);

    create table commerce.inventory_locations (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      code text unique,
      address jsonb not null default '{}'::jsonb,
      active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create trigger inventory_locations_updated_at
      before update on commerce.inventory_locations
      for each row execute function commerce.set_updated_at();

    create table commerce.inventory_levels (
      variant_id uuid not null references commerce.product_variants (id) on delete cascade,
      location_id uuid not null references commerce.inventory_locations (id) on delete cascade,
      available integer not null default 0,
      committed integer not null default 0,
      reserved integer not null default 0,
      updated_at timestamptz not null default now(),
      primary key (variant_id, location_id)
    );

    create index inventory_levels_location_id_idx on commerce.inventory_levels (location_id);

    create table commerce.inventory_movements (
      id uuid primary key default gen_random_uuid(),
      variant_id uuid not null references commerce.product_variants (id) on delete cascade,
      location_id uuid not null references commerce.inventory_locations (id) on delete cascade,
      delta integer not null,
      reason text not null,
      reference text,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create index inventory_movements_variant_id_idx
      on commerce.inventory_movements (variant_id);
    create index inventory_movements_location_id_idx
      on commerce.inventory_movements (location_id);
  `).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    drop table if exists commerce.inventory_movements;
    drop table if exists commerce.inventory_levels;
    drop table if exists commerce.inventory_locations;
    drop table if exists commerce.variant_media;
    drop table if exists commerce.product_media;
    drop table if exists commerce.variant_option_values;
    drop table if exists commerce.product_variants;
    drop table if exists commerce.product_option_values;
    drop table if exists commerce.product_options;
    drop table if exists commerce.product_collections;
    drop table if exists commerce.products;
    drop type if exists commerce.product_status;
    drop table if exists commerce.collections;
    drop type if exists commerce.collection_type;
    drop table if exists commerce.categories;
    drop table if exists commerce.media;
    drop table if exists commerce.store_settings;
  `).execute(db);
}
