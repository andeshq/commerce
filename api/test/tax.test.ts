import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHarness, type Harness } from "./helpers/harness.ts";
import { createMigrationDatabase } from "../src/database/migrator.ts";
import type { App } from "../src/lib/app.ts";

/**
 * Tax: store rate + per-variant override, inclusive vs exclusive pricing,
 * rounding per line, and the snapshot written onto the order.
 */

let h: Harness | undefined;
let app: App;
let db: ReturnType<typeof createMigrationDatabase>;
let adminCookie: string;
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
  const res = await app.fetch(new Request(`http://localhost/rest/rpc/${name}`, json(body, cookie)));
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

async function setStore(input: { includeTax: boolean; rateBps: number }): Promise<void> {
  await db
    .withSchema("commerce")
    .updateTable("store_settings")
    .set({ prices_include_tax: input.includeTax, tax_rate_bps: input.rateBps })
    .execute();
}

async function makeVariant(input: {
  price: number;
  taxable?: boolean;
  taxRateBps?: number | null;
  stock?: number;
}): Promise<string> {
  const slug = `tax-${Math.random().toString(36).slice(2, 8)}`;
  const product = await db
    .withSchema("commerce")
    .insertInto("products")
    .values({ title: "Tax item", slug, status: "active" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const variant = await db
    .withSchema("commerce")
    .insertInto("product_variants")
    .values({
      product_id: product.id,
      title: "Default",
      price_cents: input.price,
      taxable: input.taxable ?? true,
      tax_rate_bps: input.taxRateBps ?? null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  await rpc(
    "adjust_inventory",
    {
      variant: variant.id,
      location: locationId,
      reason: "stock_received",
      quantity: input.stock ?? 50,
    },
    adminCookie,
  );
  return variant.id;
}

async function purchase(
  variantId: string,
  quantity = 1,
): Promise<{ orderId: string; subtotal: string; tax: string; total: string; cartTax: string; cartTotal: string }> {
  const created = await rpc("cart_create", {});
  const token = payload(created.body).token as string;
  const added = await rpc("cart_add_item", {
    p_token: token,
    p_variant: variantId,
    p_quantity: quantity,
  });
  const cart = payload(added.body);

  const checkout = await rpc("checkout", { p_cart_token: token, p_email: "tax@andeshq.dev" });
  const orderId = payload(checkout.body).order_id as string;

  const order = await db
    .withSchema("commerce")
    .selectFrom("orders")
    .select(["subtotal_cents", "tax_cents", "total_cents"])
    .where("id", "=", orderId)
    .executeTakeFirstOrThrow();

  return {
    orderId,
    subtotal: String(order.subtotal_cents),
    tax: String(order.tax_cents),
    total: String(order.total_cents),
    cartTax: cart.tax_cents,
    cartTotal: cart.total_cents,
  };
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
        storeName: "Tax Store",
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
}, 120_000);

afterAll(async () => {
  await db?.destroy();
  await h?.dispose();
});

describe("tax: inclusive pricing", () => {
  test("extracts IVA from the price", async () => {
    await setStore({ includeTax: true, rateBps: 1900 });
    const variant = await makeVariant({ price: 119000 });
    const order = await purchase(variant, 1);
    expect(order.subtotal).toBe("100000");
    expect(order.tax).toBe("19000");
    expect(order.total).toBe("119000");
    expect(order.cartTax).toBe("19000");
    expect(order.cartTotal).toBe("119000");

    const item = await db
      .withSchema("commerce")
      .selectFrom("order_items")
      .select(["tax_cents", "tax_rate_bps", "total_cents"])
      .where("order_id", "=", order.orderId)
      .executeTakeFirstOrThrow();
    expect(item).toEqual({ tax_cents: "19000", tax_rate_bps: 1900, total_cents: "119000" });
  });
});

describe("tax: exclusive pricing", () => {
  test("adds IVA on top of the price", async () => {
    await setStore({ includeTax: false, rateBps: 1900 });
    const variant = await makeVariant({ price: 100000 });
    const order = await purchase(variant, 1);
    expect(order.subtotal).toBe("100000");
    expect(order.tax).toBe("19000");
    expect(order.total).toBe("119000");
  });

  test("rounds per line", async () => {
    await setStore({ includeTax: false, rateBps: 1900 });
    const variant = await makeVariant({ price: 3333 });
    const order = await purchase(variant, 3);
    // 9999 × 19% = 1899.81 → 1900
    expect(order.subtotal).toBe("9999");
    expect(order.tax).toBe("1900");
    expect(order.total).toBe("11899");
  });
});

describe("tax: exemptions and overrides", () => {
  test("a non-taxable variant is untaxed", async () => {
    await setStore({ includeTax: true, rateBps: 1900 });
    const variant = await makeVariant({ price: 119000, taxable: false });
    const order = await purchase(variant, 1);
    expect(order.tax).toBe("0");
    expect(order.subtotal).toBe("119000");
    expect(order.total).toBe("119000");
  });

  test("a variant rate overrides the store rate", async () => {
    await setStore({ includeTax: false, rateBps: 1900 });
    const variant = await makeVariant({ price: 100000, taxRateBps: 500 });
    const order = await purchase(variant, 1);
    expect(order.tax).toBe("5000");
    expect(order.total).toBe("105000");
  });
});

describe("tax: snapshot", () => {
  test("changing the store rate does not move an existing order", async () => {
    await setStore({ includeTax: false, rateBps: 1900 });
    const variant = await makeVariant({ price: 100000 });
    const order = await purchase(variant, 1);

    await setStore({ includeTax: false, rateBps: 500 });

    const after = await db
      .withSchema("commerce")
      .selectFrom("orders")
      .select(["tax_cents", "total_cents"])
      .where("id", "=", order.orderId)
      .executeTakeFirstOrThrow();
    expect(String(after.tax_cents)).toBe("19000");
    expect(String(after.total_cents)).toBe("119000");
  });
});
