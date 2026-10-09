import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";
import { createHarness, type Harness } from "./helpers/harness.ts";
import {
  createMigrationDatabase,
  runMigrations,
} from "../src/database/migrator.ts";

/**
 * Migration round-trip: `up` creates both schemas, `down` removes them, and
 * `up` again is idempotent (roles already exist). Guards the two ordering
 * bugs fixed in the down migrations.
 */

let h: Harness | undefined;
let url: string;

async function schemas(db: ReturnType<typeof createMigrationDatabase>) {
  const result = await sql<{ nspname: string }>`
    select nspname from pg_namespace
    where nspname in ('commerce', 'auth')
    order by nspname
  `.execute(db);
  return result.rows.map((r) => r.nspname);
}

beforeAll(async () => {
  h = await createHarness();
  url = await h!.createDatabase();
}, 120_000);

afterAll(async () => {
  await h?.dispose();
});

describe("migrations", () => {
  test("up creates commerce and auth schemas", async () => {
    const db = createMigrationDatabase(url);
    expect(await schemas(db)).toEqual(["auth", "commerce"]);
    await db.destroy();
  });

  test("down removes both schemas", async () => {
    const db = createMigrationDatabase(url);
    // Roll back every migration (guards the down-chain ordering).
    let rolledBack = 0;
    while (rolledBack < 50 && (await runMigrations(db, "down")).length > 0) {
      rolledBack++;
    }
    expect(rolledBack).toBeGreaterThan(0);
    expect(await schemas(db)).toEqual([]);
    await db.destroy();
  });

  test("up again is idempotent with roles present", async () => {
    const db = createMigrationDatabase(url);
    const results = await runMigrations(db, "up");
    expect(results.every((r) => r.status === "Success")).toBe(true);
    expect(await schemas(db)).toEqual(["auth", "commerce"]);
    await db.destroy();
  });
});
