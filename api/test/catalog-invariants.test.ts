import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { createHarness, type Harness } from "./helpers/harness.ts";
import { createMigrationDatabase } from "../src/database/migrator.ts";

let h: Harness | undefined;
let databaseUrl: string;

function slug(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

async function expectSqlState(action: Promise<unknown>, expected: string): Promise<void> {
  let caught: unknown;
  try {
    await action;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  expect((caught as { errno?: string }).errno).toBe(expected);
}

beforeAll(async () => {
  h = await createHarness();
  databaseUrl = await h.createDatabase();
}, 120_000);

afterAll(async () => {
  await h?.dispose();
});

describe("catalog database invariants", () => {
  test("product slugs are unique", async () => {
    const db = createMigrationDatabase(databaseUrl);
    const productSlug = slug("unique-product");
    try {
      await sql`insert into commerce.products (title, slug) values ('First', ${productSlug})`.execute(
        db,
      );
      await expectSqlState(
        sql`insert into commerce.products (title, slug) values ('Duplicate', ${productSlug})`.execute(
          db,
        ),
        "23505",
      );
    } finally {
      await db.destroy();
    }
  });

  test("variant prices cannot be negative", async () => {
    const db = createMigrationDatabase(databaseUrl);
    try {
      const product = await sql<{ id: string }>`
        insert into commerce.products (title, slug)
        values ('Price guard', ${slug("price-guard")})
        returning id
      `.execute(db);
      const productId = product.rows[0]!.id;

      await expectSqlState(
        sql`
          insert into commerce.product_variants (product_id, title, price_cents)
          values (${productId}, 'Invalid price', -1)
        `.execute(db),
        "23514",
      );
    } finally {
      await db.destroy();
    }
  });

  test("option names are unique store-wide and values within an option", async () => {
    const db = createMigrationDatabase(databaseUrl);
    try {
      const optionName = `Color-${randomUUID()}`;
      const option = await sql<{ id: string }>`
        insert into commerce.options (name) values (${optionName}) returning id
      `.execute(db);
      const optionId = option.rows[0]!.id;

      await expectSqlState(
        sql`insert into commerce.options (name) values (${optionName})`.execute(db),
        "23505",
      );
      await sql`insert into commerce.option_values (option_id, value) values (${optionId}, 'Blue')`.execute(
        db,
      );
      await expectSqlState(
        sql`insert into commerce.option_values (option_id, value) values (${optionId}, 'Blue')`.execute(
          db,
        ),
        "23505",
      );
    } finally {
      await db.destroy();
    }
  });

  test("options are shared across products and cannot be deleted while linked", async () => {
    const db = createMigrationDatabase(databaseUrl);
    try {
      const first = await sql<{ id: string }>`
        insert into commerce.products (title, slug)
        values ('Shared A', ${slug("shared-a")}) returning id
      `.execute(db);
      const second = await sql<{ id: string }>`
        insert into commerce.products (title, slug)
        values ('Shared B', ${slug("shared-b")}) returning id
      `.execute(db);
      const option = await sql<{ id: string }>`
        insert into commerce.options (name) values (${`Size-${randomUUID()}`}) returning id
      `.execute(db);
      const optionId = option.rows[0]!.id;

      await sql`
        insert into commerce.product_options (product_id, option_id)
        values (${first.rows[0]!.id}, ${optionId}), (${second.rows[0]!.id}, ${optionId})
      `.execute(db);

      const links = await sql<{ count: string }>`
        select count(*)::text as count from commerce.product_options where option_id = ${optionId}
      `.execute(db);
      expect(links.rows[0]?.count).toBe("2");

      // `on delete restrict` raises restrict_violation (23001), not
      // foreign_key_violation (23503) — detach from products first.
      await expectSqlState(
        sql`delete from commerce.options where id = ${optionId}`.execute(db),
        "23001",
      );
    } finally {
      await db.destroy();
    }
  });

  test("product deletion cascades variants and option links, not shared options", async () => {
    const db = createMigrationDatabase(databaseUrl);
    try {
      const product = await sql<{ id: string }>`
        insert into commerce.products (title, slug)
        values ('Cascade', ${slug("cascade")})
        returning id
      `.execute(db);
      const productId = product.rows[0]!.id;
      const option = await sql<{ id: string }>`
        insert into commerce.options (name) values (${`Size-${randomUUID()}`}) returning id
      `.execute(db);
      const optionId = option.rows[0]!.id;

      await sql`insert into commerce.option_values (option_id, value) values (${optionId}, 'M')`.execute(
        db,
      );
      await sql`insert into commerce.product_options (product_id, option_id) values (${productId}, ${optionId})`.execute(
        db,
      );
      await sql`insert into commerce.product_variants (product_id, title) values (${productId}, 'Medium')`.execute(
        db,
      );
      await sql`delete from commerce.products where id = ${productId}`.execute(db);

      const remaining = await sql<{ count: string }>`
        select (
          (select count(*) from commerce.product_variants where product_id = ${productId}) +
          (select count(*) from commerce.product_options where product_id = ${productId})
        )::text as count
      `.execute(db);
      expect(remaining.rows[0]?.count).toBe("0");

      const shared = await sql<{ count: string }>`
        select (
          (select count(*) from commerce.options where id = ${optionId}) +
          (select count(*) from commerce.option_values where option_id = ${optionId})
        )::text as count
      `.execute(db);
      expect(shared.rows[0]?.count).toBe("2");
    } finally {
      await db.destroy();
    }
  });

  test("bigint prices retain precision beyond JavaScript safe integers", async () => {
    const db = createMigrationDatabase(databaseUrl);
    try {
      const product = await sql<{ id: string }>`
        insert into commerce.products (title, slug)
        values ('Large price', ${slug("large-price")})
        returning id
      `.execute(db);
      const productId = product.rows[0]!.id;

      await sql`
        insert into commerce.product_variants (product_id, title, price_cents)
        values (${productId}, 'Large value', '9007199254740993')
      `.execute(db);
      const result = await sql<{ price_cents: string }>`
        select price_cents from commerce.product_variants where product_id = ${productId}
      `.execute(db);
      expect(result.rows[0]?.price_cents).toBe("9007199254740993");
    } finally {
      await db.destroy();
    }
  });
});
