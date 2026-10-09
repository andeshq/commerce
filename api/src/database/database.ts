import { singleton } from "tsyringe";
import { SQL } from "bun";
import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import { Config } from "../config/config.ts";
import type { DatabaseSchema } from "./types.ts";

/**
 * The application's Kysely instance, backed by Bun's native SQL client via
 * `kysely-postgres-js`. Extends `Kysely`, so it is injected anywhere a Kysely
 * instance is expected. tsyringe resolves it by type.
 */
@singleton()
export class Database extends Kysely<DatabaseSchema> {
  readonly sql: SQL;

  constructor(config: Config) {
    const sql = new SQL(config.databaseUrl);
    super({ dialect: new PostgresJSDialect({ postgres: sql }) });
    this.sql = sql;
  }

  override async destroy(): Promise<void> {
    try {
      await super.destroy();
    } finally {
      await this.sql.end();
    }
  }
}
