import "reflect-metadata";

import { randomUUID } from "node:crypto";
import { GenericContainer, Wait } from "testcontainers";
import { container } from "tsyringe";
import { sql } from "kysely";
import { Config } from "../../src/config/config.ts";
import {
  createMigrationDatabase,
  runMigrations,
} from "../../src/database/migrator.ts";
import { App } from "../../src/lib/app.ts";
import { Database } from "../../src/database/database.ts";

/** One harness owns one container and all databases/pools created from it. */
export interface Harness {
  /** Create and migrate a fresh database; returns its connection URL. */
  createDatabase(name?: string): Promise<string>;
  /** Resolve the app graph against a database URL (or a fresh database). */
  app(databaseUrl?: string): Promise<App>;
  /** Close pools, drop databases, and stop the owned container. Safe to repeat. */
  dispose(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const pg = await new GenericContainer("postgres:18-alpine")
    .withEnvironment({ POSTGRES_PASSWORD: "postgres", POSTGRES_DB: "postgres" })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage("database system is ready to accept connections", 2),
    )
    .start();

  const baseUrl = new URL(
    `postgres://postgres:postgres@${pg.getHost()}:${pg.getMappedPort(5432)}/postgres`,
  );
  const databases = new Set<string>();
  const pools = new Set<Database>();
  let disposed = false;

  function urlFor(database: string): string {
    const url = new URL(baseUrl);
    url.pathname = `/${database}`;
    return url.toString();
  }

  function assertActive(): void {
    if (disposed) throw new Error("Test harness has been disposed");
  }

  async function createDatabase(name?: string): Promise<string> {
    assertActive();
    const dbName = name ?? `test_${process.pid}_${randomUUID().replaceAll("-", "")}`;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(dbName)) {
      throw new Error(`Invalid test database name: ${dbName}`);
    }

    const ddl = createMigrationDatabase(urlFor("postgres"));
    try {
      await sql.raw(`create database "${dbName}"`).execute(ddl);
      databases.add(dbName);
    } finally {
      await ddl.destroy();
    }

    const migrationDb = createMigrationDatabase(urlFor(dbName));
    try {
      await runMigrations(migrationDb, "up");
    } finally {
      await migrationDb.destroy();
    }

    return urlFor(dbName);
  }

  async function app(databaseUrl?: string): Promise<App> {
    assertActive();
    const target = databaseUrl ?? (await createDatabase());

    // The app reads configuration from env through tsyringe singletons.
    container.clearInstances();
    process.env.DATABASE_URL = target;
    process.env.AUTH_SECRET ??= "test-secret-that-is-at-least-32-characters";
    process.env.BASE_URL ??= "http://localhost";
    process.env.PORT ??= "8080";

    container.resolve(Config);
    pools.add(container.resolve(Database));
    return container.resolve(App);
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    const errors: unknown[] = [];

    container.clearInstances();
    for (const pool of pools) {
      try {
        await pool.destroy();
      } catch (error) {
        errors.push(error);
      }
    }

    try {
      const ddl = createMigrationDatabase(urlFor("postgres"));
      try {
        for (const dbName of databases) {
          try {
            await sql
              .raw(`drop database if exists "${dbName}" with (force)`)
              .execute(ddl);
          } catch (error) {
            errors.push(error);
          }
        }
      } finally {
        await ddl.destroy();
      }
    } catch (error) {
      errors.push(error);
    } finally {
      try {
        await pg.stop();
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to dispose test harness cleanly");
    }
  }

  return { createDatabase, app, dispose };
}
