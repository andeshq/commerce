import { sql, type Kysely } from "kysely";

/**
 * Store settings keep their option lists in code (zod enums + the app's
 * reference data); the database only guards the *format* of the codes so a
 * direct REST write cannot store junk. `es-CO` is intentional: the region is
 * what makes Intl format COP as `$ 79.900`.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    alter table commerce.store_settings
      add constraint store_settings_currency_code_format
        check (currency_code ~ '^[A-Z]{3}$'),
      add constraint store_settings_locale_format
        check (locale ~ '^[a-z]{2}-[A-Z]{2}$');
  `).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    alter table commerce.store_settings
      drop constraint if exists store_settings_locale_format,
      drop constraint if exists store_settings_currency_code_format;
  `).execute(db);
}
