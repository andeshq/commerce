import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { createHarness, type Harness } from "./helpers/harness.ts";
import { createMigrationDatabase } from "../src/database/migrator.ts";
import type { App } from "../src/lib/app.ts";

/**
 * Inventory adjustments run through the `commerce.adjust_inventory` RPC:
 * the function owns the level+movement transaction, reads the actor from the
 * request context, and is the only write path (direct DML is revoked).
 */

let h: Harness | undefined;
let app: App;
let db: ReturnType<typeof createMigrationDatabase>;
let adminCookie: string;
let customerCookie: string;
let variantId: string;
let locationId: string;
let inactiveLocationId: string;
let adminUserId: string;

function json(body: unknown, cookie?: string): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  };
}

function cookieFrom(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function signIn(email: string, password: string): Promise<string> {
  const res = await app.fetch(
    new Request("http://localhost/api/auth/sign-in/email", json({ email, password })),
  );
  return cookieFrom(res);
}

async function rpc(
  body: Record<string, unknown>,
  cookie?: string,
): Promise<{ status: number; body: Record<string, any> }> {
  const res = await app.fetch(
    new Request("http://localhost/api/rest/rpc/adjust_inventory", json(body, cookie)),
  );
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, body: parsed as Record<string, any> };
}

async function rest(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await app.fetch(new Request(`http://localhost/api/rest${path}`, init));
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, body };
}

function levelFor(variant: string, location: string): Promise<number | null> {
  return db
    .withSchema("commerce")
    .selectFrom("inventory_levels")
    .select("available")
    .where("variant_id", "=", variant)
    .where("location_id", "=", location)
    .executeTakeFirst()
    .then((row) => row?.available ?? null);
}

beforeAll(async () => {
  h = await createHarness();
  const databaseUrl = await h.createDatabase();
  app = await h.app(databaseUrl);
  db = createMigrationDatabase(databaseUrl);

  await app.fetch(
    new Request(
      "http://localhost/api/setup",
      json({
        email: "admin@andeshq.dev",
        password: "supersecret123",
        name: "Admin",
        storeName: "Test Store",
      }),
    ),
  );
  adminCookie = await signIn("admin@andeshq.dev", "supersecret123");

  const admin = await sql<{ id: string }>`
    select id from auth."user" where email = ${"admin@andeshq.dev"}
  `.execute(db);
  adminUserId = admin.rows[0]?.id ?? "";

  const product = await db
    .withSchema("commerce")
    .insertInto("products")
    .values({ title: "Widget", slug: "widget" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const variant = await db
    .withSchema("commerce")
    .insertInto("product_variants")
    .values({ product_id: product.id, title: "Default", price_cents: 1000 })
    .returning("id")
    .executeTakeFirstOrThrow();
  variantId = variant.id;

  // Setup creates the store's first location (`MAIN`).
  const location = await db
    .withSchema("commerce")
    .selectFrom("inventory_locations")
    .select("id")
    .where("code", "=", "MAIN")
    .executeTakeFirstOrThrow();
  locationId = location.id;

  const closed = await db
    .withSchema("commerce")
    .insertInto("inventory_locations")
    .values({ name: "Sede cerrada", code: "CLOSED", active: false })
    .returning("id")
    .executeTakeFirstOrThrow();
  inactiveLocationId = closed.id;

  await app.fetch(
    new Request(
      "http://localhost/api/auth/sign-up/email",
      json({ email: "buyer@andeshq.dev", password: "supersecret123", name: "Buyer" }),
    ),
  );
  customerCookie = await signIn("buyer@andeshq.dev", "supersecret123");
});

afterAll(async () => {
  await db?.destroy();
  await h?.dispose();
});

describe("inventory adjustments via rpc", () => {
  test("stock received writes the level, movement and actor", async () => {
    const res = await rpc(
      {
        variant: variantId,
        location: locationId,
        reason: "stock_received",
        quantity: 10,
        note: "Compra inicial",
      },
      adminCookie,
    );

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].available).toBe(10);
    expect(res.body[0].delta).toBe(10);

    const movement = await db
      .withSchema("commerce")
      .selectFrom("inventory_movements")
      .select(["delta", "reason", "metadata", "created_by", "created_by_name"])
      .where("id", "=", res.body[0].movement_id)
      .executeTakeFirstOrThrow();
    expect(movement.delta).toBe(10);
    expect(movement.reason).toBe("stock_received");
    expect(movement.metadata).toEqual({ note: "Compra inicial" });
    expect(movement.created_by).toBe(adminUserId);
    expect(movement.created_by_name).toBe("Admin");
    expect(await levelFor(variantId, locationId)).toBe(10);
  });

  test("inventory recount sets the counted quantity", async () => {
    const res = await rpc(
      { variant: variantId, location: locationId, reason: "inventory_recount", quantity: 7 },
      adminCookie,
    );

    expect(res.status).toBe(200);
    expect(res.body[0].available).toBe(7);
    expect(res.body[0].delta).toBe(-3);
  });

  test("a recount that changes nothing is rejected", async () => {
    const res = await rpc(
      { variant: variantId, location: locationId, reason: "inventory_recount", quantity: 7 },
      adminCookie,
    );

    expect(res.status).toBe(400);
    expect(String(res.body.message)).toContain("nothing to record");
  });

  test("deductions cannot drop stock below zero", async () => {
    const res = await rpc(
      { variant: variantId, location: locationId, reason: "theft", quantity: 8 },
      adminCookie,
    );

    expect(res.status).toBe(400);
    expect(String(res.body.message)).toContain("Only 7 on hand");
    expect(await levelFor(variantId, locationId)).toBe(7);
  });

  test("damage, loss and restock return apply signed deltas", async () => {
    expect(
      (
        await rpc(
          {
            variant: variantId,
            location: locationId,
            reason: "damage",
            quantity: 3,
            note: "Manchadas",
          },
          adminCookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await rpc(
          { variant: variantId, location: locationId, reason: "loss", quantity: 1 },
          adminCookie,
        )
      ).status,
    ).toBe(200);

    const res = await rpc(
      { variant: variantId, location: locationId, reason: "restock_return", quantity: 2 },
      adminCookie,
    );
    expect(res.status).toBe(200);
    expect(res.body[0].available).toBe(5);

    const movements = await db
      .withSchema("commerce")
      .selectFrom("inventory_movements")
      .select(["delta", "reason"])
      .where("variant_id", "=", variantId)
      .where("location_id", "=", locationId)
      .orderBy("created_at", "asc")
      .execute();
    expect(movements.map((movement) => movement.delta)).toEqual([10, -3, -3, -1, 2]);
    expect(await levelFor(variantId, locationId)).toBe(5);
  });

  test("levels are tracked per location", async () => {
    const other = await db
      .withSchema("commerce")
      .insertInto("inventory_locations")
      .values({ name: "Bodega Norte", code: "NORTE" })
      .returning("id")
      .executeTakeFirstOrThrow();

    const res = await rpc(
      { variant: variantId, location: other.id, reason: "stock_received", quantity: 4 },
      adminCookie,
    );
    expect(res.status).toBe(200);
    expect(res.body[0].available).toBe(4);
    expect(await levelFor(variantId, other.id)).toBe(4);
    expect(await levelFor(variantId, locationId)).toBe(5);
  });

  test("unknown variants and locations are rejected", async () => {
    const unknownVariant = await rpc(
      { variant: randomUUID(), location: locationId, reason: "stock_received", quantity: 1 },
      adminCookie,
    );
    expect(unknownVariant.status).toBe(400);
    expect(String(unknownVariant.body.message)).toContain("Variant not found");

    const unknownLocation = await rpc(
      { variant: variantId, location: randomUUID(), reason: "stock_received", quantity: 1 },
      adminCookie,
    );
    expect(unknownLocation.status).toBe(400);
    expect(String(unknownLocation.body.message)).toContain("Location not found");
  });

  test("inactive locations are rejected", async () => {
    const res = await rpc(
      { variant: variantId, location: inactiveLocationId, reason: "stock_received", quantity: 1 },
      adminCookie,
    );

    expect(res.status).toBe(400);
    expect(String(res.body.message)).toContain("inactive");
  });

  test("only staff can adjust stock", async () => {
    const anonymous = await rpc({
      variant: variantId,
      location: locationId,
      reason: "stock_received",
      quantity: 1,
    });
    expect(anonymous.status).toBe(401);

    const customer = await rpc(
      { variant: variantId, location: locationId, reason: "stock_received", quantity: 1 },
      customerCookie,
    );
    expect(customer.status).toBe(403);
    expect(await levelFor(variantId, locationId)).toBe(5);
  });

  test("staff cannot write inventory tables directly", async () => {
    const insertLevel = await rest("/inventory_levels", {
      ...json(
        { variant_id: variantId, location_id: locationId, available: 999 },
        adminCookie,
      ),
    });
    expect(insertLevel.status).toBe(403);

    const updateLevel = await rest(
      `/inventory_levels?variant_id=eq.${variantId}&location_id=eq.${locationId}`,
      { ...json({ available: 999 }, adminCookie), method: "PATCH" },
    );
    expect(updateLevel.status).toBe(403);

    const deleteMovements = await rest(
      `/inventory_movements?variant_id=eq.${variantId}`,
      { ...json({}, adminCookie), method: "DELETE" },
    );
    expect(deleteMovements.status).toBe(403);

    expect(await levelFor(variantId, locationId)).toBe(5);
  });

  test("staff can read movement history, customers cannot", async () => {
    const staff = await rest(
      `/inventory_movements?select=delta&variant_id=eq.${variantId}&location_id=eq.${locationId}&order=created_at.asc`,
      { headers: { cookie: adminCookie } },
    );
    expect(staff.status).toBe(200);
    expect((staff.body as Array<{ delta: number }>).map((row) => row.delta)).toEqual([
      10, -3, -3, -1, 2,
    ]);

    const customer = await rest(`/inventory_movements?select=delta&variant_id=eq.${variantId}`, {
      headers: { cookie: customerCookie },
    });
    expect(customer.status).toBe(403);
  });
});

describe("inventory locations", () => {
  test("codes are unique case-insensitively", async () => {
    await expect(
      db
        .withSchema("commerce")
        .insertInto("inventory_locations")
        .values({ name: "Duplicate", code: "main" })
        .execute(),
    ).rejects.toThrow();
  });

  test("deleting a location cascades its levels and movements", async () => {
    const doomed = await db
      .withSchema("commerce")
      .insertInto("inventory_locations")
      .values({ name: "Doomed", code: "DOOMED" })
      .returning("id")
      .executeTakeFirstOrThrow();

    await sql`
      insert into commerce.inventory_levels (variant_id, location_id, available)
      values (${variantId}, ${doomed.id}, 3)
    `.execute(db);
    await sql`
      insert into commerce.inventory_movements (variant_id, location_id, delta, reason)
      values (${variantId}, ${doomed.id}, 3, 'stock_received')
    `.execute(db);

    await db
      .withSchema("commerce")
      .deleteFrom("inventory_locations")
      .where("id", "=", doomed.id)
      .execute();

    const levels = await db
      .withSchema("commerce")
      .selectFrom("inventory_levels")
      .select("variant_id")
      .where("location_id", "=", doomed.id)
      .execute();
    const movements = await db
      .withSchema("commerce")
      .selectFrom("inventory_movements")
      .select("id")
      .where("location_id", "=", doomed.id)
      .execute();
    expect(levels).toEqual([]);
    expect(movements).toEqual([]);
  });
});
