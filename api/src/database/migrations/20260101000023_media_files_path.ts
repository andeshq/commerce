import { sql, type Kysely } from "kysely";

/**
 * Media bytes moved under the API namespace: `/media/<file>` is now served at
 * `/api/media/files/<file>`. `media.url` is stored relative, so rewrite the
 * existing rows once instead of leaving dead links behind.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    update commerce.media
      set url = '/api/media/files/' || regexp_replace(url, '^/media/', '')
      where url like '/media/%';
  `).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    update commerce.media
      set url = '/media/' || regexp_replace(url, '^/api/media/files/', '')
      where url like '/api/media/files/%';
  `).execute(db);
}
