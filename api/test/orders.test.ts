import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHarness, type Harness } from "./helpers/harness.ts";
import { createMigrationDatabase } from "../src/database/migrator.ts";
import type { App } from "../src/lib/app.ts";

/**
 * Checkout: cart -> order in one transaction, stock moved through the shared
 * ledger, idempotent retries, and the RLS split (staff all, customer own, anon
 * denied; guests use the order access token).
 */

let h: Harness | undefined;
let app: App;
let db: ReturnType<typeof createMigrationDatabase>;
let adminCookie: string;
let customerCookie: string;
let otherCustomerCookie: string;
let variantId: string;
let limitedVariantId: string;
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
    new Request(`http://localhost/rest/rpc/${name}`, json(body, cookie)),
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

async function rest(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: any }> {
  const res = await app.fetch(new Request(`http://localhost/rest${path}`, init));
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

function payload(body: any): any {
  return Array.isArray(body) ? body[0] : body;
}

async function signIn(email: string): Promise<string> {
  const res = await app.fetch(
    new Request(
      "http://localhost/api/auth/sign-in/email",
      json({ email, password: "supersecret123" }),
    ),
  );
  return cookieFrom(res);
}

async function signUp(email: string): Promise<string> {
  await app.fetch(
    new Request(
      "http://localhost/api/auth/sign-up/email",
      json({ email, password: "supersecret123", name: email.split("@")[0] }),
    ),
  );
  return signIn(email);
}

async function placeOrder(cookie?: string): Promise<{ token: string; orderId: string; cart: string }> {
  const created = await rpc("cart_create", {}, cookie);
  const cart = payload(created.body).token as string;
  const addRes = await rpc(
    "cart_add_item",
    { p_token: cart, p_variant: variantId, p_quantity: 1 },
    cookie,
  );
  if (addRes.status >= 300) throw new Error(`seed add failed: ${addRes.status}`);
  const order = await rpc(
    "checkout",
    { p_cart_token: cart, p_email: "buyer@andeshq.dev" },
    cookie,
  );
  const row = payload(order.body);
  return { token: row.access_token as string, orderId: row.order_id as string, cart };
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
        storeName: "Orders Store",
      }),
    ),
  );
  adminCookie = await signIn("admin@andeshq.dev");
  customerCookie = await signUp("buyer@andeshq.dev");
  otherCustomerCookie = await signUp("other@andeshq.dev");

  const location = await db
    .withSchema("commerce")
    .selectFrom("inventory_locations")
    .select("id")
    .where("is_default", "=", true)
    .executeTakeFirstOrThrow();
  locationId = location.id;

  const product = await db
    .withSchema("commerce")
    .insertInto("products")
    .values({ title: "Hoodie", slug: "hoodie", status: "active" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const variant = await db
    .withSchema("commerce")
    .insertInto("product_variants")
    .values({ product_id: product.id, title: "L", sku: "HOOD-L", price_cents: 100000 })
    .returning("id")
    .executeTakeFirstOrThrow();
  variantId = variant.id;

  const limited = await db
    .withSchema("commerce")
    .insertInto("products")
    .values({ title: "Limited", slug: "limited", status: "active" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const limitedVariant = await db
    .withSchema("commerce")
    .insertInto("product_variants")
    .values({ product_id: limited.id, title: "Only", sku: "LTD", price_cents: 50000 })
    .returning("id")
    .executeTakeFirstOrThrow();
  limitedVariantId = limitedVariant.id;

  await rpc(
    "adjust_inventory",
    { variant: variantId, location: locationId, reason: "stock_received", quantity: 10 },
    adminCookie,
  );
  await rpc(
    "adjust_inventory",
    { variant: limitedVariantId, location: locationId, reason: "stock_received", quantity: 1 },
    adminCookie,
  );
}, 120_000);

afterAll(async () => {
  await db?.destroy();
  await h?.dispose();
});

describe("checkout", () => {
  test("creates the order, snapshots lines and takes stock", async () => {
    const created = await rpc("cart_create", {});
    const token = payload(created.body).token as string;
    await rpc("cart_add_item", { p_token: token, p_variant: variantId, p_quantity: 2 });

    const { status, body } = await rpc("checkout", {
      p_cart_token: token,
      p_email: "guest@andeshq.dev",
      p_shipping_address: { line1: "Calle 1", city: "Bogotá" },
    });
    expect(status).toBe(200);
    const order = payload(body);
    expect(order.total_cents).toBe("200000");

    const items = await db
      .withSchema("commerce")
      .selectFrom("order_items")
      .select(["product_title", "quantity", "unit_price_cents", "total_cents"])
      .where("order_id", "=", order.order_id)
      .execute();
    expect(items).toEqual([
      {
        product_title: "Hoodie",
        quantity: 2,
        unit_price_cents: "100000",
        total_cents: "200000",
      },
    ]);

    const movement = await db
      .withSchema("commerce")
      .selectFrom("inventory_movements")
      .select(["delta", "reason", "reference"])
      .where("variant_id", "=", variantId)
      .where("reference", "=", order.order_id)
      .executeTakeFirstOrThrow();
    expect(movement).toMatchObject({ delta: -2, reason: "order_placed" });

    const level = await db
      .withSchema("commerce")
      .selectFrom("inventory_levels")
      .select("available")
      .where("variant_id", "=", variantId)
      .where("location_id", "=", locationId)
      .executeTakeFirstOrThrow();
    expect(level.available).toBe(8);

    const cart = await db
      .withSchema("commerce")
      .selectFrom("carts")
      .select(["status", "converted_order_id"])
      .where("token", "=", token)
      .executeTakeFirstOrThrow();
    expect(cart.status).toBe("converted");
    expect(cart.converted_order_id).toBe(order.order_id);
  });

  test("is idempotent on the key", async () => {
    const a = await rpc("cart_create", {});
    const tokenA = payload(a.body).token as string;
    await rpc("cart_add_item", { p_token: tokenA, p_variant: variantId, p_quantity: 1 });

    const first = await rpc("checkout", {
      p_cart_token: tokenA,
      p_email: "guest@andeshq.dev",
      p_idempotency_key: "retry-123",
    });
    const second = await rpc("checkout", {
      p_cart_token: tokenA,
      p_email: "guest@andeshq.dev",
      p_idempotency_key: "retry-123",
    });
    expect(payload(second.body).order_id).toBe(payload(first.body).order_id);

    const count = await db
      .withSchema("commerce")
      .selectFrom("orders")
      .select((eb) => eb.fn.countAll().as("count"))
      .where("idempotency_key", "=", "retry-123")
      .executeTakeFirstOrThrow();
    expect(Number(count.count)).toBe(1);
  });

  test("refuses an empty cart", async () => {
    const created = await rpc("cart_create", {});
    const token = payload(created.body).token as string;
    const { status, body } = await rpc("checkout", {
      p_cart_token: token,
      p_email: "guest@andeshq.dev",
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(String(body.message)).toContain("empty");
  });

  test("fails without stock and rolls back", async () => {
    const created = await rpc("cart_create", {});
    const token = payload(created.body).token as string;
    await rpc("cart_add_item", { p_token: token, p_variant: limitedVariantId, p_quantity: 1 });

    // Someone else takes the last unit.
    await db
      .withSchema("commerce")
      .updateTable("inventory_levels")
      .set({ available: 0 })
      .where("variant_id", "=", limitedVariantId)
      .where("location_id", "=", locationId)
      .execute();

    const { status, body } = await rpc("checkout", {
      p_cart_token: token,
      p_email: "guest@andeshq.dev",
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(String(body.message)).toContain("Only 0 on hand");

    const cart = await db
      .withSchema("commerce")
      .selectFrom("carts")
      .select("status")
      .where("token", "=", token)
      .executeTakeFirstOrThrow();
    expect(cart.status).toBe("open");
  });

  test("order_get returns the order for the token holder", async () => {
    const created = await rpc("cart_create", {});
    const token = payload(created.body).token as string;
    await rpc("cart_add_item", { p_token: token, p_variant: variantId, p_quantity: 1 });
    const order = await rpc("checkout", {
      p_cart_token: token,
      p_email: "guest@andeshq.dev",
    });
    const accessToken = payload(order.body).access_token as string;

    const fetched = await rpc("order_get", { p_token: accessToken });
    expect(fetched.status).toBe(200);
    const doc = payload(fetched.body);
    expect(doc.items).toHaveLength(1);
    expect(doc.total_cents).toBe("100000");

    const wrong = await rpc("order_get", { p_token: "nope" });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
  });
});

describe("orders rls", () => {
  test("anon cannot list orders", async () => {
    const { status } = await rest("/orders?select=id");
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test("staff can list orders", async () => {
    const { status, body } = await rest("/orders?select=number", {
      headers: { cookie: adminCookie },
    });
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  test("a customer sees only their own orders", async () => {
    const { token } = await placeOrder(customerCookie);
    expect(token.length).toBeGreaterThan(20);

    const mine = await rest("/orders?select=id,customer_id", {
      headers: { cookie: customerCookie },
    });
    expect(mine.status).toBe(200);
    expect((mine.body as any[]).length).toBeGreaterThan(0);

    const theirs = await rest("/orders?select=id,customer_id", {
      headers: { cookie: otherCustomerCookie },
    });
    expect(theirs.status).toBe(200);
    expect(theirs.body).toEqual([]);
  });
});

describe("order actions", () => {
  test("staff mark paid and fulfill; anon cannot", async () => {
    const { orderId } = await placeOrder();

    const denied = await rpc("order_mark_paid", { order_uuid: orderId });
    expect(denied.status).toBeGreaterThanOrEqual(400);

    const paid = await rpc("order_mark_paid", { order_uuid: orderId }, adminCookie);
    expect(paid.status).toBe(200);

    await rpc("order_fulfill", { order_uuid: orderId }, adminCookie);

    const order = await db
      .withSchema("commerce")
      .selectFrom("orders")
      .select(["payment_status", "status", "fulfillment_status"])
      .where("id", "=", orderId)
      .executeTakeFirstOrThrow();
    expect(order).toEqual({
      payment_status: "paid",
      status: "completed",
      fulfillment_status: "fulfilled",
    });
  });

  test("cancelling restocks through the ledger", async () => {
    // A fresh variant so the assertion isn't entangled with other tests.
    const product = await db
      .withSchema("commerce")
      .insertInto("products")
      .values({ title: "Cancel me", slug: "cancel-me", status: "active" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const variant = await db
      .withSchema("commerce")
      .insertInto("product_variants")
      .values({ product_id: product.id, title: "Default", sku: "CANCEL", price_cents: 1000 })
      .returning("id")
      .executeTakeFirstOrThrow();

    await rpc(
      "adjust_inventory",
      { variant: variant.id, location: locationId, reason: "stock_received", quantity: 5 },
      adminCookie,
    );

    const created = await rpc("cart_create", {});
    const token = payload(created.body).token as string;
    await rpc("cart_add_item", { p_token: token, p_variant: variant.id, p_quantity: 2 });
    const order = await rpc("checkout", { p_cart_token: token, p_email: "guest@andeshq.dev" });
    const orderId = payload(order.body).order_id as string;

    const level = (): Promise<number> =>
      db
        .withSchema("commerce")
        .selectFrom("inventory_levels")
        .select("available")
        .where("variant_id", "=", variant.id)
        .where("location_id", "=", locationId)
        .executeTakeFirstOrThrow()
        .then((row) => row.available);

    expect(await level()).toBe(3);

    await rpc("order_cancel", { order_uuid: orderId }, adminCookie);
    expect(await level()).toBe(5);

    const restock = await db
      .withSchema("commerce")
      .selectFrom("inventory_movements")
      .select(["delta", "reason"])
      .where("variant_id", "=", variant.id)
      .where("reason", "=", "order_cancelled")
      .executeTakeFirstOrThrow();
    expect(restock).toEqual({ delta: 2, reason: "order_cancelled" });
  });
});
