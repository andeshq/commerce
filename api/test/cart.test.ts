import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createHarness, type Harness } from "./helpers/harness.ts";
import { createMigrationDatabase } from "../src/database/migrator.ts";
import type { App } from "../src/lib/app.ts";

/**
 * Guest carts run entirely through the `commerce.cart_*` RPCs, keyed by a
 * secret token. Prices and availability are rebuilt from the catalog on every
 * call, so nothing in the cart is trusted.
 */

let h: Harness | undefined;
let app: App;
let db: ReturnType<typeof createMigrationDatabase>;
let adminCookie: string;
let variantId: string;
let draftVariantId: string;
let locationId: string;

function json(body: unknown, cookie?: string): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  };
}

function cookieFrom(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function rpc(
  name: string,
  body: Record<string, unknown>,
  cookie?: string,
): Promise<{ status: number; body: any }> {
  const res = await app.fetch(
    new Request(`http://localhost/api/rest/rpc/${name}`, json(body, cookie)),
  );
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, body: parsed };
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
        storeName: "Cart Store",
      }),
    ),
  );
  const signIn = await app.fetch(
    new Request(
      "http://localhost/api/auth/sign-in/email",
      json({ email: "admin@andeshq.dev", password: "supersecret123" }),
    ),
  );
  adminCookie = cookieFrom(signIn);

  const location = await db
    .withSchema("commerce")
    .selectFrom("inventory_locations")
    .select("id")
    .where("is_default", "=", true)
    .executeTakeFirstOrThrow();
  locationId = location.id;

  // Cart mechanics are the subject here; tax is covered in tax.test.ts.
  await db
    .withSchema("commerce")
    .updateTable("store_settings")
    .set({ tax_rate_bps: 0, prices_include_tax: false })
    .execute();

  const product = await db
    .withSchema("commerce")
    .insertInto("products")
    .values({ title: "Tees", slug: "tees", status: "active" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const variant = await db
    .withSchema("commerce")
    .insertInto("product_variants")
    .values({ product_id: product.id, title: "Medium", sku: "TEE-M", price_cents: 100000 })
    .returning("id")
    .executeTakeFirstOrThrow();
  variantId = variant.id;

  const draft = await db
    .withSchema("commerce")
    .insertInto("products")
    .values({ title: "Hidden", slug: "hidden", status: "draft" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const draftVariant = await db
    .withSchema("commerce")
    .insertInto("product_variants")
    .values({ product_id: draft.id, title: "Default", sku: "HIDDEN", price_cents: 5000 })
    .returning("id")
    .executeTakeFirstOrThrow();
  draftVariantId = draftVariant.id;

  await rpc(
    "adjust_inventory",
    { variant: variantId, location: locationId, reason: "stock_received", quantity: 5 },
    adminCookie,
  );
}, 120_000);

afterAll(async () => {
  await db?.destroy();
  await h?.dispose();
});

/** pgbase returns a scalar (jsonb) RPC as a one-element array. */
function payload(body: any): any {
  return Array.isArray(body) ? body[0] : body;
}

async function newCart(): Promise<string> {
  const { status, body } = await rpc("cart_create", {});
  expect(status).toBe(200);
  return payload(body).token as string;
}

describe("cart rpc", () => {
  test("a guest can create an empty cart", async () => {
    const { status, body } = await rpc("cart_create", {});
    expect(status).toBe(200);
    const row = payload(body);
    expect(typeof row.token).toBe("string");
    expect(row.token.length).toBeGreaterThan(20);
  });

  test("adding an item returns the rebuilt cart with live price", async () => {
    const token = await newCart();
    const { status, body } = await rpc("cart_add_item", {
      p_token: token,
      p_variant: variantId,
      p_quantity: 2,
    });
    expect(status).toBe(200);
    const cart = payload(body);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({
      variant_id: variantId,
      quantity: 2,
      unit_price_cents: "100000",
      line_total_cents: "200000",
      available: 5,
    });
    expect(cart.item_count).toBe(2);
    expect(cart.subtotal_cents).toBe("200000");
  });

  test("adding the same variant accumulates the quantity", async () => {
    const token = await newCart();
    await rpc("cart_add_item", { p_token: token, p_variant: variantId, p_quantity: 1 });
    const { body } = await rpc("cart_add_item", {
      p_token: token,
      p_variant: variantId,
      p_quantity: 2,
    });
    const cart = payload(body);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].quantity).toBe(3);
  });

  test("adding beyond available stock is rejected", async () => {
    const token = await newCart();
    const { status, body } = await rpc("cart_add_item", {
      p_token: token,
      p_variant: variantId,
      p_quantity: 6,
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(String(body.message)).toContain("Only 5 available");
  });

  test("a draft product's variant cannot be added", async () => {
    const token = await newCart();
    const { status, body } = await rpc("cart_add_item", {
      p_token: token,
      p_variant: draftVariantId,
      p_quantity: 1,
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(String(body.message)).toContain("not available");
  });

  test("updating quantity to zero removes the line", async () => {
    const token = await newCart();
    const added = await rpc("cart_add_item", {
      p_token: token,
      p_variant: variantId,
      p_quantity: 2,
    });
    const itemId = payload(added.body).items[0].id;
    const { body } = await rpc("cart_update_item", {
      p_token: token,
      p_item: itemId,
      p_quantity: 0,
    });
    const cart = payload(body);
    expect(cart.items).toHaveLength(0);
    expect(cart.subtotal_cents).toBe("0");
  });

  test("removing a line returns the remaining cart", async () => {
    const token = await newCart();
    const added = await rpc("cart_add_item", {
      p_token: token,
      p_variant: variantId,
      p_quantity: 1,
    });
    const itemId = payload(added.body).items[0].id;
    const { body } = await rpc("cart_remove_item", { p_token: token, p_item: itemId });
    expect(payload(body).items).toHaveLength(0);
  });

  test("an unknown token is rejected", async () => {
    const { status } = await rpc("cart_get", { p_token: randomUUID() });
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test("the token is not required to be a session: anon works", async () => {
    const token = await newCart();
    const { status } = await rpc("cart_add_item", {
      p_token: token,
      p_variant: variantId,
      p_quantity: 1,
    });
    expect(status).toBe(200);
  });
});
