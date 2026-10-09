import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHarness, type Harness } from "./helpers/harness.ts";
import { createMigrationDatabase } from "../src/database/migrator.ts";
import type { App } from "../src/lib/app.ts";

/**
 * Order-lifecycle hardening: unpaid orders expire and restock, payment state is
 * monotonic (stale/regressive events ignored), and money after a cancel is
 * flagged rather than silently re-taking stock.
 */

let h: Harness | undefined;
let app: App;
let db: ReturnType<typeof createMigrationDatabase>;
let adminCookie: string;
let variantId: string;
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

async function rest(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
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

async function webhook(body: Record<string, unknown>): Promise<number> {
  const res = await app.fetch(
    new Request("http://localhost/api/payments/fake/webhook", json(body)),
  );
  return res.status;
}

async function createOrder(quantity = 1): Promise<{ orderId: string; accessToken: string; total: number }> {
  const created = await rest("/rpc/cart_create", json({}));
  const token = payload(created.body).token as string;
  await rest("/rpc/cart_add_item", json({ p_token: token, p_variant: variantId, p_quantity: quantity }));
  const order = await rest("/rpc/checkout", json({ p_cart_token: token, p_email: "buyer@example.com" }));
  const row = payload(order.body);
  return { orderId: row.order_id, accessToken: row.access_token, total: Number(row.total_cents) };
}

async function payIntent(accessToken: string): Promise<any> {
  const res = await app.fetch(
    new Request(`http://localhost/api/checkout/${accessToken}/pay`, { method: "POST" }),
  );
  return res.json();
}

async function stock(): Promise<number> {
  const row = await db
    .withSchema("commerce")
    .selectFrom("inventory_levels")
    .select("available")
    .where("variant_id", "=", variantId)
    .where("location_id", "=", locationId)
    .executeTakeFirstOrThrow();
  return row.available;
}

async function orderRow(orderId: string): Promise<{ status: string; payment_status: string }> {
  return db
    .withSchema("commerce")
    .selectFrom("orders")
    .select(["status", "payment_status"])
    .where("id", "=", orderId)
    .executeTakeFirstOrThrow();
}

beforeAll(async () => {
  h = await createHarness();
  const databaseUrl = await h.createDatabase();
  app = await h.app(databaseUrl);
  db = createMigrationDatabase(databaseUrl);

  await app.fetch(
    new Request(
      "http://localhost/api/setup",
      json({ email: "admin@andeshq.dev", password: "supersecret123", name: "Admin", storeName: "Lifecycle Store" }),
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

  const product = await db
    .withSchema("commerce")
    .insertInto("products")
    .values({ title: "Lifecycle item", slug: "lifecycle-item", status: "active" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const variant = await db
    .withSchema("commerce")
    .insertInto("product_variants")
    .values({ product_id: product.id, title: "Default", price_cents: 100000 })
    .returning("id")
    .executeTakeFirstOrThrow();
  variantId = variant.id;

  await rest("/rpc/adjust_inventory", {
    ...json({ variant: variantId, location: locationId, reason: "stock_received", quantity: 50 }, adminCookie),
  });
}, 120_000);

afterAll(async () => {
  await db?.destroy();
  await h?.dispose();
});

describe("unpaid order expiry", () => {
  test("cancels and restocks an order past the cutoff", async () => {
    const { orderId } = await createOrder(2);
    expect(await stock()).toBe(48);

    const future = new Date(Date.now() + 60_000).toISOString();
    const res = await rest("/rpc/expire_stale_orders", json({ p_before: future }, adminCookie));
    expect(res.status).toBe(200);
    expect(payload(res.body)).toBeGreaterThanOrEqual(1);

    expect(await stock()).toBe(50);
    expect(await orderRow(orderId)).toMatchObject({ status: "cancelled" });

    const movement = await db
      .withSchema("commerce")
      .selectFrom("inventory_movements")
      .select("reason")
      .where("variant_id", "=", variantId)
      .where("reason", "=", "order_expired")
      .executeTakeFirst();
    expect(movement?.reason).toBe("order_expired");

    const event = await db
      .withSchema("commerce")
      .selectFrom("order_events")
      .select("type")
      .where("order_id", "=", orderId)
      .where("type", "=", "expired")
      .executeTakeFirst();
    expect(event?.type).toBe("expired");
  });

  test("leaves recent orders alone", async () => {
    const { orderId } = await createOrder(1);
    const past = new Date(Date.now() - 60 * 60_000).toISOString();
    await rest("/rpc/expire_stale_orders", json({ p_before: past }, adminCookie));
    expect((await orderRow(orderId)).status).toBe("open");
  });

  test("leaves paid orders alone", async () => {
    const { orderId } = await createOrder(1);
    await rest("/rpc/order_mark_paid", json({ order_uuid: orderId }, adminCookie));

    const future = new Date(Date.now() + 60_000).toISOString();
    await rest("/rpc/expire_stale_orders", json({ p_before: future }, adminCookie));
    expect(await orderRow(orderId)).toMatchObject({ status: "open", payment_status: "paid" });
  });
});

describe("payment state is monotonic", () => {
  test("ignores a stale decline after approval", async () => {
    const { orderId, accessToken, total } = await createOrder();
    const intent = await payIntent(accessToken);

    await webhook({
      event_id: "e-approve",
      provider_ref: intent.provider_ref,
      status: "paid",
      amount_cents: total,
      occurred_at: "2026-01-01T10:00:00.000Z",
    });
    expect((await orderRow(orderId)).payment_status).toBe("paid");

    // Older event must be ignored.
    await webhook({
      event_id: "e-stale-decline",
      provider_ref: intent.provider_ref,
      status: "failed",
      amount_cents: total,
      occurred_at: "2026-01-01T09:00:00.000Z",
    });
    expect((await orderRow(orderId)).payment_status).toBe("paid");

    // Even a newer decline must not downgrade a paid order.
    await webhook({
      event_id: "e-late-decline",
      provider_ref: intent.provider_ref,
      status: "failed",
      amount_cents: total,
      occurred_at: "2026-01-01T11:00:00.000Z",
    });
    expect((await orderRow(orderId)).payment_status).toBe("paid");
  });

  test("flags money that arrives after a cancel", async () => {
    const { orderId, accessToken, total } = await createOrder(1);
    const intent = await payIntent(accessToken);

    const future = new Date(Date.now() + 60_000).toISOString();
    await rest("/rpc/expire_stale_orders", json({ p_before: future }, adminCookie));
    expect((await orderRow(orderId)).status).toBe("cancelled");

    await webhook({
      event_id: "e-paid-after-cancel",
      provider_ref: intent.provider_ref,
      status: "paid",
      amount_cents: total,
      occurred_at: new Date().toISOString(),
    });

    const row = await orderRow(orderId);
    expect(row.status).toBe("cancelled");
    expect(row.payment_status).toBe("paid");

    const flagged = await db
      .withSchema("commerce")
      .selectFrom("order_events")
      .select("type")
      .where("order_id", "=", orderId)
      .where("type", "=", "payment_after_cancel")
      .executeTakeFirst();
    expect(flagged?.type).toBe("payment_after_cancel");
  });
});

describe("multiple providers", () => {
  test("several can be enabled and the public methods list is ordered", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/payments/providers/wompi", {
        ...json({ enabled: true }, adminCookie),
        method: "PUT",
      }),
    );
    expect(res.status).toBe(200);

    const providers = await db
      .withSchema("commerce")
      .selectFrom("payment_providers")
      .select(["provider", "enabled"])
      .execute();
    expect(providers.filter((p) => p.enabled).map((p) => p.provider).sort()).toEqual([
      "fake",
      "wompi",
    ]);

    const methods = await app.fetch(new Request("http://localhost/api/payments/methods"));
    expect(methods.status).toBe(200);
    const list = (await methods.json()) as Array<{ provider: string; is_default: boolean }>;
    expect(list.map((m) => m.provider).sort()).toEqual(["fake", "wompi"]);
    expect(list.find((m) => m.is_default)?.provider).toBe("fake");
  });

  test("pay accepts an explicit provider and rejects an unknown one", async () => {
    const { accessToken } = await createOrder();
    const ok = await app.fetch(
      new Request(`http://localhost/api/checkout/${accessToken}/pay`, {
        ...json({ provider: "fake" }),
        method: "POST",
      }),
    );
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).provider).toBe("fake");

    const bad = await app.fetch(
      new Request(`http://localhost/api/checkout/${accessToken}/pay`, {
        ...json({ provider: "nope" }),
        method: "POST",
      }),
    );
    expect(bad.status).toBe(409);
  });
});
