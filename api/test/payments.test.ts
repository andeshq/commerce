import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHarness, type Harness } from "./helpers/harness.ts";
import { createMigrationDatabase } from "../src/database/migrator.ts";
import type { App } from "../src/lib/app.ts";

/**
 * Payments through the fake provider: create an intent for an order token,
 * confirm it over the webhook (idempotently), and gate provider config to
 * admins. Webhooks run on the owner connection, so this also covers the
 * privileged apply path.
 */

let h: Harness | undefined;
let app: App;
let db: ReturnType<typeof createMigrationDatabase>;
let adminCookie: string;
let customerCookie: string;
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

async function createOrder(): Promise<{ orderId: string; accessToken: string; total: number }> {
  const created = await rpc("cart_create", {});
  const token = payload(created.body).token as string;
  await rpc("cart_add_item", { p_token: token, p_variant: variantId, p_quantity: 1 });
  const order = await rpc("checkout", { p_cart_token: token, p_email: "guest@andeshq.dev" });
  const row = payload(order.body);
  return {
    orderId: row.order_id as string,
    accessToken: row.access_token as string,
    total: Number(row.total_cents),
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
        storeName: "Pay Store",
      }),
    ),
  );
  adminCookie = await signIn("admin@andeshq.dev");
  customerCookie = await signUp("buyer@andeshq.dev");

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
    .values({ title: "Cap", slug: "cap", status: "active" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const variant = await db
    .withSchema("commerce")
    .insertInto("product_variants")
    .values({ product_id: product.id, title: "Default", sku: "CAP", price_cents: 50000 })
    .returning("id")
    .executeTakeFirstOrThrow();
  variantId = variant.id;

  await rpc(
    "adjust_inventory",
    { variant: variantId, location: locationId, reason: "stock_received", quantity: 100 },
    adminCookie,
  );
}, 120_000);

afterAll(async () => {
  await db?.destroy();
  await h?.dispose();
});

describe("payments: fake provider", () => {
  test("starting a payment returns an intent", async () => {
    const { accessToken } = await createOrder();
    const res = await app.fetch(new Request(`http://localhost/api/checkout/${accessToken}/pay`, { method: "POST" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.provider).toBe("fake");
    expect(body.status).toBe("pending");
    expect(String(body.provider_ref)).toStartWith("fake_");
    expect(body.confirm.body.status).toBe("paid");
  });

  test("a webhook marks the order paid", async () => {
    const { accessToken, orderId } = await createOrder();
    const intent = (await (
      await app.fetch(new Request(`http://localhost/api/checkout/${accessToken}/pay`, { method: "POST" }))
    ).json()) as any;

    const webhook = await app.fetch(
      new Request("http://localhost/api/payments/fake/webhook", json(intent.confirm.body)),
    );
    expect(webhook.status).toBe(200);

    const order = await db
      .withSchema("commerce")
      .selectFrom("orders")
      .select("payment_status")
      .where("id", "=", orderId)
      .executeTakeFirstOrThrow();
    expect(order.payment_status).toBe("paid");

    const payment = await db
      .withSchema("commerce")
      .selectFrom("payments")
      .select("status")
      .where("order_id", "=", orderId)
      .executeTakeFirstOrThrow();
    expect(payment.status).toBe("paid");
  });

  test("replaying a webhook is idempotent", async () => {
    const { accessToken, orderId } = await createOrder();
    const intent = (await (
      await app.fetch(new Request(`http://localhost/api/checkout/${accessToken}/pay`, { method: "POST" }))
    ).json()) as any;

    await app.fetch(
      new Request("http://localhost/api/payments/fake/webhook", json(intent.confirm.body)),
    );
    await app.fetch(
      new Request("http://localhost/api/payments/fake/webhook", json(intent.confirm.body)),
    );

    const events = await db
      .withSchema("commerce")
      .selectFrom("payment_events")
      .select((eb) => eb.fn.countAll().as("count"))
      .where("event_id", "=", intent.confirm.body.event_id)
      .executeTakeFirstOrThrow();
    expect(Number(events.count)).toBe(1);

    const orderEvents = await db
      .withSchema("commerce")
      .selectFrom("order_events")
      .select((eb) => eb.fn.countAll().as("count"))
      .where("order_id", "=", orderId)
      .where("type", "=", "payment")
      .executeTakeFirstOrThrow();
    expect(Number(orderEvents.count)).toBe(1);
  });

  test("paying an already-paid order is rejected", async () => {
    const { accessToken } = await createOrder();
    const first = await app.fetch(new Request(`http://localhost/api/checkout/${accessToken}/pay`, { method: "POST" }));
    const intent = (await first.json()) as any;
    await app.fetch(
      new Request("http://localhost/api/payments/fake/webhook", json(intent.confirm.body)),
    );

    const again = await app.fetch(new Request(`http://localhost/api/checkout/${accessToken}/pay`, { method: "POST" }));
    expect(again.status).toBe(409);
  });

  test("refund flips the payment and order", async () => {
    const { accessToken, orderId } = await createOrder();
    const intent = (await (
      await app.fetch(new Request(`http://localhost/api/checkout/${accessToken}/pay`, { method: "POST" }))
    ).json()) as any;
    await app.fetch(
      new Request("http://localhost/api/payments/fake/webhook", json(intent.confirm.body)),
    );

    const refund = await app.fetch(
      new Request(`http://localhost/api/orders/${orderId}/refund`, json({}, adminCookie)),
    );
    expect(refund.status).toBe(200);
    expect(((await refund.json()) as any).status).toBe("refunded");

    const order = await db
      .withSchema("commerce")
      .selectFrom("orders")
      .select("payment_status")
      .where("id", "=", orderId)
      .executeTakeFirstOrThrow();
    expect(order.payment_status).toBe("refunded");
  });
});

describe("payments: provider settings", () => {
  test("anon and customers cannot read or edit providers", async () => {
    const anon = await app.fetch(new Request("http://localhost/api/payments/providers"));
    expect(anon.status).toBe(401);
    const customer = await app.fetch(
      new Request("http://localhost/api/payments/providers", { headers: { cookie: customerCookie } }),
    );
    expect(customer.status).toBe(403);
  });

  test("an admin lists and updates providers without credentials", async () => {
    const list = await app.fetch(
      new Request("http://localhost/api/payments/providers", { headers: { cookie: adminCookie } }),
    );
    expect(list.status).toBe(200);
    const providers = (await list.json()) as any[];
    const fake = providers.find((p) => p.provider === "fake");
    expect(fake).toMatchObject({ provider: "fake", enabled: true, mode: "test" });
    expect(fake.credentials).toBeUndefined();

    const updated = await app.fetch(
      new Request("http://localhost/api/payments/providers/fake", {
        ...json({ enabled: true, mode: "live", credentials: { api_key: "secret" } }, adminCookie),
        method: "PUT",
      }),
    );
    expect(updated.status).toBe(200);
    const body = (await updated.json()) as any;
    expect(body).toMatchObject({ provider: "fake", enabled: true, mode: "live", configured: true });
    expect(body.credentials).toBeUndefined();
  });
});
