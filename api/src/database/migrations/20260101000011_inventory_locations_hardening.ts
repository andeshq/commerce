import { sql, type Kysely } from "kysely";

/**
 * Inventory locations hardening:
 *  - codes compare case-insensitively (`MAIN` == `main`): the plain
 *    `code text unique` constraint becomes a functional unique index on
 *    lower(code). Nulls stay distinct, so several locations can omit a code.
 *    The seed's upsert targets the index expression.
 *  - `web_anon`/`web_customer` lose their select grant. RLS already returned
 *    zero rows (the policy is staff-only), so the grant was dead weight; a
 *    permission error is more honest than an empty result.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    revoke select on commerce.inventory_locations from web_anon, web_customer;

    alter table commerce.inventory_locations
      drop constraint if exists inventory_locations_code_key;

    create unique index inventory_locations_code_ci_key
      on commerce.inventory_locations (lower(code));
  `).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    drop index if exists commerce.inventory_locations_code_ci_key;

    alter table commerce.inventory_locations
      add constraint inventory_locations_code_key unique (code);

    grant select on commerce.inventory_locations to web_anon, web_customer;
  `).execute(db);
}
