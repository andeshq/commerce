import { promises as fs } from "node:fs";
import * as path from "node:path";
import { SQL } from "bun";
import { Kysely } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import { PostgresJSDialect } from "kysely-postgres-js";

export type MigrationDirection = "up" | "down";

export interface MigrationResult {
  name: string;
  direction: MigrationDirection;
  status: "Success" | "Error" | "NotExecuted";
}

/** Build a Migrator over the migrations folder in this directory. */
export function createMigrator(db: Kysely<any>): Migrator {
  return new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(import.meta.dir, "migrations"),
    }),
  });
}

/** Open a throwaway Kysely instance for DDL. Caller must `destroy()`. */
export function createMigrationDatabase(connectionString: string): Kysely<any> {
  const sql = new SQL(connectionString);
  return new Kysely<any>({
    dialect: new PostgresJSDialect({ postgres: sql }),
  });
}

/** Apply all pending migrations (or roll back one). Throws on failure. */
export async function runMigrations(
  db: Kysely<any>,
  direction: MigrationDirection = "up",
): Promise<MigrationResult[]> {
  const migrator = createMigrator(db);
  const { error, results } =
    direction === "down"
      ? await migrator.migrateDown()
      : await migrator.migrateToLatest();

  if (error) throw error;

  return (results ?? []).map((result) => ({
    name: result.migrationName,
    direction: result.direction as MigrationDirection,
    status: result.status as MigrationResult["status"],
  }));
}
