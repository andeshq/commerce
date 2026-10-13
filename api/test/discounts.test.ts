import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createMigrationDatabase } from "../src/database/migrator.ts";
import type { App } from "../src/lib/app.ts";
import { createHarness, type Harness } from "./helpers/harness.ts";

/**
 * Discount codes: percentage and fixed, minimum subtotal, expiry, usage limit,
 * and the tax interaction (tax is recomputed on the discounted base).
 */

let h: Harness | undefined;
let app: App;
let db: ReturnType<typeof createMigrationDatabase>;
let adminCookie: string;
let locationId: string;
let variantId: string;

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
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

function payload(body: any): any {
  return Array.isArray(body) ? body[0] : body;
}

async function newCart(quantity = 1): Promise<string> {
  const created = await rpc("cart_create", {});
  const token = payload(created.body).token as string;
  await rpc("cart_add_item", { p_token: token, p_variant: variantId, p_quantity: quantity });
  return token;
}

async function addDiscount(input: {
  code: string;
  type: "percentage" | "fixed";
  value: number;
  minSubtotal?: number;
  startsAt?: string;
  endsAt?: string;
  usageLimit?: number;
  active?: boolean;
}): Promise<string> {
  const row = await db
    .withSchema("commerce")
    .insertInto("discounts")
    .values({
      code: input.code,
      type: input.type,
      value: input.value,
      min_subtotal_cents: input.minSubtotal ?? 0,
      starts_at: input.startsAt ? new Date(input.startsAt) : null,
      ends_at: input.endsAt ? new Date(input.endsAt) : null,
      usage_limit: input.usageLimit ?? null,
      active: input.active ?? true,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
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
        storeName: "Discount Store",
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

  // Exclusive pricing at 19% so the tax-on-discounted-base rule is visible.
  await db
    .withSchema("commerce")
    .updateTable("store_settings")
    .set({ prices_include_tax: false, tax_rate_bps: 1900 })
    .execute();

  const product = await db
    .withSchema("commerce")
    .insertInto("products")
    .values({ title: "Boots", slug: "boots", status: "active" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const variant = await db
    .withSchema("commerce")
    .insertInto("product_variants")
    .values({ product_id: product.id, title: "Default", sku: "BOOT", price_cents: 100000 })
    .returning("id")
    .executeTakeFirstOrThrow();
  variantId = variant.id;

  await rpc(
    "adjust_inventory",
    { variant: variantId, location: locationId, reason: "stock_received", quantity: 500 },
    adminCookie,
  );
}, 120_000);

afterAll(async () => {
  await db?.destroy();
  await h?.dispose();
});

describe("discount codes: applying to a cart", () => {
  test("a percentage code reduces the cart and recomputes tax", async () => {
    await addDiscount({ code: "TEN", type: "percentage", value: 1000 });
    const token = await newCart(2);

    const { status, body } = await rpc("cart_apply_discount", {
      p_token: token,
      p_code: "ten",
    });
    expect(status).toBe(200);
    const cart = payload(body);
    expect(cart.subtotal_cents).toBe("200000");
    expect(cart.discount_cents).toBe("20000");
    expect(cart.discount_code).toBe("TEN");
    // 180000 × 19% = 34200
    expect(cart.tax_cents).toBe("34200");
    expect(cart.total_cents).toBe("214200");
  });

  test("a fixed code never exceeds the subtotal", async () => {
    await addDiscount({ code: "BIG", type: "fixed", value: 500000 });
    const token = await newCart(1);
    const { body } = await rpc("cart_apply_discount", { p_token: token, p_code: "BIG" });
    const cart = payload(body);
    expect(cart.discount_cents).toBe("100000");
    expect(cart.tax_cents).toBe("0");
    expect(cart.total_cents).toBe("0");
  });

  test("a minimum subtotal is enforced", async () => {
    await addDiscount({ code: "MIN", type: "percentage", value: 1000, minSubtotal: 500000 });
    const token = await newCart(1);
    const { status, body } = await rpc("cart_apply_discount", { p_token: token, p_code: "MIN" });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(String(body.message)).toContain("minimum subtotal");
  });

  test("an unknown code is rejected", async () => {
    const token = await newCart(1);
    const { status } = await rpc("cart_apply_discount", { p_token: token, p_code: "NOPE" });
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test("an expired code is rejected", async () => {
    await addDiscount({
      code: "OLD",
      type: "percentage",
      value: 1000,
      endsAt: "2000-01-01T00:00:00Z",
    });
    const token = await newCart(1);
    const { status, body } = await rpc("cart_apply_discount", { p_token: token, p_code: "OLD" });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(String(body.message)).toContain("expired");
  });

  test("an inactive code is rejected", async () => {
    await addDiscount({ code: "OFF", type: "percentage", value: 1000, active: false });
    const token = await newCart(1);
    const { status } = await rpc("cart_apply_discount", { p_token: token, p_code: "OFF" });
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test("removing the discount restores the cart", async () => {
    await addDiscount({ code: "DROP", type: "percentage", value: 1000 });
    const token = await newCart(1);
    await rpc("cart_apply_discount", { p_token: token, p_code: "DROP" });
    const { body } = await rpc("cart_remove_discount", { p_token: token });
    const cart = payload(body);
    expect(cart.discount_cents).toBe("0");
    expect(cart.discount_code).toBeNull();
    expect(cart.total_cents).toBe("119000");
  });
});

describe("discount codes: checkout", () => {
  test("the order snapshots the discount and the code", async () => {
    await addDiscount({ code: "SAVE10", type: "percentage", value: 1000 });
    const token = await newCart(2);
    await rpc("cart_apply_discount", { p_token: token, p_code: "SAVE10" });

    const checkout = await rpc("checkout", { p_cart_token: token, p_email: "d@andeshq.dev" });
    expect(checkout.status).toBe(200);
    const orderId = payload(checkout.body).order_id as string;

    const order = await db
      .withSchema("commerce")
      .selectFrom("orders")
      .select(["subtotal_cents", "discount_cents", "discount_code", "tax_cents", "total_cents"])
      .where("id", "=", orderId)
      .executeTakeFirstOrThrow();

    expect(String(order.subtotal_cents)).toBe("200000");
    expect(String(order.discount_cents)).toBe("20000");
    expect(order.discount_code).toBe("SAVE10");
    expect(String(order.tax_cents)).toBe("34200");
    expect(String(order.total_cents)).toBe("214200");

    const payment = await db
      .withSchema("commerce")
      .selectFrom("payments")
      .select("amount_cents")
      .where("order_id", "=", orderId)
      .executeTakeFirstOrThrow();
    expect(String(payment.amount_cents)).toBe("214200");
  });

  test("a code that expired after being applied fails at checkout", async () => {
    const id = await addDiscount({ code: "SOON", type: "percentage", value: 1000 });
    const token = await newCart(1);
    await rpc("cart_apply_discount", { p_token: token, p_code: "SOON" });

    await db
      .withSchema("commerce")
      .updateTable("discounts")
      .set({ ends_at: new Date("2000-01-01T00:00:00Z") })
      .where("id", "=", id)
      .execute();

    const { status, body } = await rpc("checkout", {
      p_cart_token: token,
      p_email: "d@andeshq.dev",
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(String(body.message)).toContain("expired");
  });

  test("checkout increments times_used and honours the usage limit", async () => {
    const id = await addDiscount({ code: "ONCE", type: "percentage", value: 1000, usageLimit: 1 });

    const first = await newCart(1);
    await rpc("cart_apply_discount", { p_token: first, p_code: "ONCE" });
    const ok = await rpc("checkout", { p_cart_token: first, p_email: "d@andeshq.dev" });
    expect(ok.status).toBe(200);

    const used = await db
      .withSchema("commerce")
      .selectFrom("discounts")
      .select("times_used")
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(used.times_used).toBe(1);

    // The next attempt cannot even apply it.
    const second = await newCart(1);
    const rejected = await rpc("cart_apply_discount", { p_token: second, p_code: "ONCE" });
    expect(rejected.status).toBeGreaterThanOrEqual(400);
    expect(String(rejected.body.message)).toContain("usage limit");
  });

  test("codes are unreadable by anon", async () => {
    const res = await app.fetch(new Request("http://localhost/api/rest/discounts?select=code"));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("discount codes: admin REST surface", () => {
  test("staff can create, list and update a discount", async () => {
    const create = await app.fetch(
      new Request(
        "http://localhost/api/rest/discounts",
        json(
          {
            code: "ADMIN10",
            type: "percentage",
            value: 1500,
            min_subtotal_cents: 0,
            active: true,
          },
          adminCookie,
        ),
      ),
    );
    expect(create.status).toBe(201);

    const list = await app.fetch(
      new Request("http://localhost/api/rest/discounts?select=code,type,value&code=eq.ADMIN10", {
        headers: { cookie: adminCookie },
      }),
    );
    expect(list.status).toBe(200);
    const rows = (await list.json()) as Array<{ code: string; type: string; value: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: "ADMIN10", type: "percentage", value: 1500 });

    const update = await app.fetch(
      new Request("http://localhost/api/rest/discounts?code=eq.ADMIN10", {
        ...json({ active: false }, adminCookie),
        method: "PATCH",
      }),
    );
    expect(update.status).toBeLessThan(300);
  });

  test("the code column rejects a malformed code", async () => {
    const bad = await app.fetch(
      new Request(
        "http://localhost/api/rest/discounts",
        json({ code: "not valid", type: "percentage", value: 1000 }, adminCookie),
      ),
    );
    expect(bad.status).toBeGreaterThanOrEqual(400);
  });
});
