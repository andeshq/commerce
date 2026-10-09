import {
  createMigrationDatabase,
  createMigrator,
  runMigrations,
} from "./migrator.ts";

/**
 * Standalone migration CLI.
 *
 *   bun run migrate          # migrate to latest
 *   bun run migrate:down     # roll back the most recent migration
 *   bun run migrate:list     # show status without applying
 *
 * Migrations are NOT run on server boot: schema changes are an explicit,
 * auditable step. `Migrator` takes a database lock, so concurrent runs across
 * instances are safe.
 *
 * The connection role (DATABASE_URL) must own the schema and be able to create
 * roles/policies. This is the DDL connection, separate from the impersonated
 * `web_*` roles the app uses at runtime.
 */
type Direction = "up" | "down" | "list";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required to run migrations.");
    process.exit(1);
  }

  const direction = (process.argv[2] ?? "up") as Direction;
  const db = createMigrationDatabase(connectionString);

  try {
    if (direction === "list") {
      const migrations = await createMigrator(db).getMigrations();
      for (const migration of migrations) {
        const mark = migration.executedAt ? "✔" : "·";
        const when = migration.executedAt
          ? migration.executedAt.toISOString()
          : "pending";
        console.log(`${mark} ${migration.name}  (${when})`);
      }
      return;
    }

    const results = await runMigrations(db, direction);
    for (const result of results) {
      if (result.status === "Success") {
        console.log(`✔ ${result.direction} ${result.name}`);
      } else if (result.status === "Error") {
        console.error(`✘ ${result.direction} ${result.name}`);
      } else {
        console.log(`· skipped ${result.name}`);
      }
    }
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

await main();
