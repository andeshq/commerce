import { sql, type Kysely } from "kysely";

/**
 * Register Wompi as an available payment provider (disabled by default; an
 * admin enables it and pastes the public/private/integrity/events keys in
 * Settings). The `wompi` implementation lives in
 * `api/src/service/payment/wompi.provider.ts`.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    insert into commerce.payment_providers (provider, enabled, mode)
    values ('wompi', false, 'test')
    on conflict (provider) do nothing;
  `).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`delete from commerce.payment_providers where provider = 'wompi';`).execute(db);
}
