import { sql, type Kysely } from "kysely";

/**
 * Schemas, Postgres roles and the `updated_at` trigger helper.
 *
 * Roles mirror PostgREST's model so pgbase can `SET LOCAL ROLE` per request.
 * DDL-only: store settings and the first admin are created at first-run setup.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    create schema if not exists commerce;
    create schema if not exists auth;

    create extension if not exists "pgcrypto";
    create extension if not exists "citext";
  `).execute(db);

  await sql.raw(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'web_anon') then
        create role web_anon nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'web_customer') then
        create role web_customer nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'web_staff') then
        create role web_staff nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'web_admin') then
        create role web_admin nologin;
      end if;
    end
    $$;
  `).execute(db);

  await sql.raw(`
    grant web_customer to web_staff;
    grant web_staff to web_admin;
  `).execute(db);

  await sql.raw(`
    create or replace function commerce.set_updated_at()
      returns trigger
      language plpgsql
    as $$
      begin
        new.updated_at = now();
        return new;
      end;
    $$;
  `).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // Schemas only. Postgres roles are cluster-global and shared across
  // databases, so they are intentionally NOT dropped here — dropping them from
  // a per-database rollback could break other databases and leaves stale
  // pg_shdepend ACL entries behind. Remove roles deliberately at the cluster
  // level if you really need to.
  await sql.raw(`
    drop function if exists commerce.set_updated_at();
    drop schema if exists commerce cascade;
    drop schema if exists auth cascade;
  `).execute(db);
}
