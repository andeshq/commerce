import { sql, type Kysely } from "kysely";

/**
 * Store-scoped item options: `options` + `option_values` are reusable across
 * products (Square-style), `product_options` becomes a pure link table, and
 * `variant_option_values` points at the shared values.
 *
 * The catalog is still pre-release, so this migration refuses to run when
 * products exist rather than silently dropping option rows. Once real catalogs
 * exist, replace the guard with a backfill that dedupes by name/value and
 * remaps the IDs referenced by `variant_option_values`.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    do $$
    begin
      if exists (select 1 from commerce.products) then
        raise exception 'options migration expects an empty catalog; write a backfill first';
      end if;
    end
    $$;

    alter table commerce.variant_option_values
      drop constraint variant_option_values_option_value_id_fkey;

    drop table commerce.product_option_values;
    drop table commerce.product_options;

    create table commerce.options (
      id uuid primary key default gen_random_uuid(),
      name text not null unique,
      position integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create trigger options_updated_at
      before update on commerce.options
      for each row execute function commerce.set_updated_at();

    create table commerce.option_values (
      id uuid primary key default gen_random_uuid(),
      option_id uuid not null references commerce.options (id) on delete cascade,
      value text not null,
      position integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (option_id, value)
    );

    create index option_values_option_id_idx on commerce.option_values (option_id);

    create trigger option_values_updated_at
      before update on commerce.option_values
      for each row execute function commerce.set_updated_at();

    create table commerce.product_options (
      product_id uuid not null references commerce.products (id) on delete cascade,
      option_id uuid not null references commerce.options (id) on delete restrict,
      position integer not null default 0,
      primary key (product_id, option_id)
    );

    create index product_options_option_id_idx on commerce.product_options (option_id);

    alter table commerce.variant_option_values
      add constraint variant_option_values_option_value_id_fkey
        foreign key (option_value_id) references commerce.option_values (id) on delete cascade;

    grant select, insert, update, delete on commerce.options, commerce.option_values,
      commerce.product_options to web_staff, web_admin;
    grant select on commerce.options, commerce.option_values, commerce.product_options
      to web_anon, web_customer;

    alter table commerce.options enable row level security;
    alter table commerce.option_values enable row level security;
    alter table commerce.product_options enable row level security;

    create policy options_read on commerce.options
      for select using (true);
    create policy options_write on commerce.options
      for all using (commerce.is_staff()) with check (commerce.is_staff());

    create policy option_values_read on commerce.option_values
      for select using (true);
    create policy option_values_write on commerce.option_values
      for all using (commerce.is_staff()) with check (commerce.is_staff());

    create policy product_options_read on commerce.product_options
      for select using (
        commerce.is_staff() or exists (
          select 1 from commerce.products p
          where p.id = product_options.product_id and p.status = 'active'
        )
      );
    create policy product_options_write on commerce.product_options
      for all using (commerce.is_staff()) with check (commerce.is_staff());
  `).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    alter table commerce.variant_option_values
      drop constraint variant_option_values_option_value_id_fkey;

    drop table commerce.product_options;
    drop table commerce.option_values;
    drop table commerce.options;

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

    alter table commerce.variant_option_values
      add constraint variant_option_values_option_value_id_fkey
        foreign key (option_value_id) references commerce.product_option_values (id) on delete cascade;
  `).execute(db);
}
