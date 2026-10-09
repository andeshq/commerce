import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHarness, type Harness } from "./helpers/harness.ts";
import { createMigrationDatabase } from "../src/database/migrator.ts";
import type { App } from "../src/lib/app.ts";
import {
  wompiEventChecksum,
  wompiIntegritySignature,
  wompiProvider,
} from "../src/service/payment/wompi.provider.ts";

/**
 * Wompi: known-answer signature vectors from the docs, the Web Checkout URL,
 * and an end-to-end transaction.updated event over the webhook endpoint.
 */

describe("wompi signatures (docs vectors)", () => {
  test("integrity signature", () => {
    expect(
      wompiIntegritySignature(
        "sk8-438k4-xmxm392-sn2m",
        2490000,
        "COP",
        "prod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6",
      ),
    ).toBe("37c8407747e595535433ef8f6a811d853cd943046624a0ec04662b17bbf33bf5");
  });

  test("event checksum", () => {
    // Wompi's docs example output doesn't match its own documented inputs
    // (the Step 1 id differs from the sample body), so we pin the SHA256 of the
    // exact concatenation they describe: properties + timestamp + secret.
    const checksum = wompiEventChecksum(
      { transaction: { id: "1234-1610641025-49201", status: "APPROVED", amount_in_cents: 4490000 } },
      ["transaction.id", "transaction.status", "transaction.amount_in_cents"],
      1530291411,
      "prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z",
    );
    expect(checksum).toBe(
      "5a18ec5e8fdb7df463e9f94774cba8f583ba21bd04a09ceff2ea68a4bc0aefbe",
    );
  });
});

describe("wompi createIntent", () => {
  const ctx = {
    mode: "test" as const,
    credentials: {
      publicKey: "pub_test_X0zDA9xoKdePzhd8a0x9HAez7HgGO2fH",
      integritySecret: "test_integrity_abc123",
    },
  };

  test("builds a signed Web Checkout URL", async () => {
    const intent = await wompiProvider.createIntent(
      {
        orderId: "o1",
        orderNumber: "1001",
        amountCents: 119000,
        currencyCode: "COP",
        email: "buyer@example.com",
        taxCents: 19000,
        returnUrl: "https://shop.example.com/thanks",
      },
      ctx,
    );

    expect(intent.status).toBe("pending");
    const url = new URL(intent.clientPayload.checkout_url as string);
    expect(url.origin + url.pathname).toBe("https://checkout.wompi.co/p/");
    expect(url.searchParams.get("public-key")).toBe(ctx.credentials.publicKey);
    expect(url.searchParams.get("currency")).toBe("COP");
    expect(url.searchParams.get("amount-in-cents")).toBe("119000");
    expect(url.searchParams.get("reference")).toBe(intent.providerRef);
    expect(url.searchParams.get("customer-data:email")).toBe("buyer@example.com");
    expect(url.searchParams.get("redirect-url")).toBe("https://shop.example.com/thanks");
    expect(url.searchParams.get("tax-in-cents:vat")).toBe("19000");
    expect(url.searchParams.get("signature:integrity")).toBe(
      wompiIntegritySignature(
        intent.providerRef,
        119000,
        "COP",
        ctx.credentials.integritySecret,
      ),
    );
  });

  test("rejects non-COP currencies", async () => {
    await expect(
      wompiProvider.createIntent(
        { orderId: "o1", orderNumber: "1", amountCents: 100, currencyCode: "USD", email: "a@b.co" },
        ctx,
      ),
    ).rejects.toThrow("COP");
  });

  test("rejects missing credentials", async () => {
    await expect(
      wompiProvider.createIntent(
        { orderId: "o1", orderNumber: "1", amountCents: 100, currencyCode: "COP", email: "a@b.co" },
        { mode: "test", credentials: {} },
      ),
    ).rejects.toThrow("public key");
  });
});

let h: Harness | undefined;
let app: App;
let db: ReturnType<typeof createMigrationDatabase>;
let adminCookie: string;
let variantId: string;
let locationId: string;

const WOMPI_CREDENTIALS = {
  publicKey: "pub_test_X0zDA9xoKdePzhd8a0x9HAez7HgGO2fH",
  privateKey: "prv_test_0000000000000000000000000000",
  integritySecret: "test_integrity_abc123",
  eventsSecret: "test_events_secret123",
};

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
  const res = await app.fetch(new Request(`http://localhost/api/rest${path}`, init));
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

beforeAll(async () => {
  h = await createHarness();
  const databaseUrl = await h.createDatabase();
  app = await h.app(databaseUrl);
  db = createMigrationDatabase(databaseUrl);

  await app.fetch(
    new Request(
      "http://localhost/api/setup",
      json({ email: "admin@andeshq.dev", password: "supersecret123", name: "Admin", storeName: "Wompi Store" }),
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
    .values({ title: "Wompi item", slug: "wompi-item", status: "active" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const variant = await db
    .withSchema("commerce")
    .insertInto("product_variants")
    .values({ product_id: product.id, title: "Default", price_cents: 50000 })
    .returning("id")
    .executeTakeFirstOrThrow();
  variantId = variant.id;

  await rest("/rpc/adjust_inventory", {
    ...json({ variant: variantId, location: locationId, reason: "stock_received", quantity: 10 }, adminCookie),
  });

  // Make Wompi the enabled provider (checkout picks the single enabled one).
  await db
    .withSchema("commerce")
    .updateTable("payment_providers")
    .set({ enabled: false })
    .execute();
  await db
    .withSchema("commerce")
    .updateTable("payment_providers")
    .set({ enabled: true, mode: "test", credentials: WOMPI_CREDENTIALS })
    .where("provider", "=", "wompi")
    .execute();
}, 120_000);

afterAll(async () => {
  await db?.destroy();
  await h?.dispose();
});

async function createOrder(): Promise<{ orderId: string; accessToken: string; total: number }> {
  const created = await rest("/rpc/cart_create", json({}));
  const token = payload(created.body).token as string;
  await rest("/rpc/cart_add_item", json({ p_token: token, p_variant: variantId, p_quantity: 1 }));
  const order = await rest(
    "/rpc/checkout",
    json({ p_cart_token: token, p_email: "buyer@example.com" }),
  );
  const row = payload(order.body);
  return { orderId: row.order_id, accessToken: row.access_token, total: Number(row.total_cents) };
}

describe("wompi end to end", () => {
  test("checkout uses wompi and pay returns a signed checkout URL", async () => {
    const { accessToken } = await createOrder();
    const res = await app.fetch(
      new Request(`http://localhost/api/checkout/${accessToken}/pay?returnUrl=https://shop.example.com/thanks`, {
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.provider).toBe("wompi");
    expect(String(body.checkout_url)).toStartWith("https://checkout.wompi.co/p/?");
  });

  test("a signed transaction.updated event marks the order paid", async () => {
    const { orderId, accessToken, total } = await createOrder();
    const intent = (await (
      await app.fetch(new Request(`http://localhost/api/checkout/${accessToken}/pay`, { method: "POST" }))
    ).json()) as any;

    const properties = ["transaction.id", "transaction.status", "transaction.amount_in_cents"];
    const timestamp = 1700000000;
    const data = {
      transaction: {
        id: "wompi-tx-1",
        reference: intent.reference,
        status: "APPROVED",
        amount_in_cents: total,
        payment_method_type: "NEQUI",
      },
    };
    const checksum = wompiEventChecksum(data, properties, timestamp, WOMPI_CREDENTIALS.eventsSecret);
    const event = {
      event: "transaction.updated",
      data,
      sent_at: "2026-01-01T00:00:00.000Z",
      timestamp,
      signature: { properties, checksum },
    };

    const hook = await app.fetch(
      new Request("http://localhost/api/payments/wompi/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Event-Checksum": checksum },
        body: JSON.stringify(event),
      }),
    );
    expect(hook.status).toBe(200);

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
      .select(["status", "method", "metadata"])
      .where("order_id", "=", orderId)
      .executeTakeFirstOrThrow();
    expect(payment.status).toBe("paid");
    expect(payment.method).toBe("NEQUI");
    expect((payment.metadata as any).provider_transaction_id).toBe("wompi-tx-1");
  });

  test("a tampered checksum is rejected", async () => {
    const { accessToken, total } = await createOrder();
    const intent = (await (
      await app.fetch(new Request(`http://localhost/api/checkout/${accessToken}/pay`, { method: "POST" }))
    ).json()) as any;

    const properties = ["transaction.id", "transaction.status", "transaction.amount_in_cents"];
    const event = {
      event: "transaction.updated",
      data: {
        transaction: {
          id: "wompi-tx-2",
          reference: intent.reference,
          status: "APPROVED",
          amount_in_cents: total,
        },
      },
      sent_at: "2026-01-01T00:00:00.000Z",
      timestamp: 1700000001,
      signature: { properties, checksum: "deadbeef" },
    };

    const hook = await app.fetch(
      new Request("http://localhost/api/payments/wompi/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Event-Checksum": "deadbeef" },
        body: JSON.stringify(event),
      }),
    );
    expect(hook.status).toBe(401);
  });
});
