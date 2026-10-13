import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createMigrationDatabase } from "../src/database/migrator.ts";
import type { App } from "../src/lib/app.ts";
import { createHarness, type Harness } from "./helpers/harness.ts";

/**
 * Manual collections: staff curate products into a collection, the storefront
 * lists collections and reads one with its products. Draft products stay
 * hidden by RLS even when linked.
 */

let h: Harness | undefined;
let app: App;
let db: ReturnType<typeof createMigrationDatabase>;
let adminCookie: string;

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

async function adminPost(path: string, body: Record<string, unknown>): Promise<any> {
  const res = await app.fetch(
    new Request(`http://localhost/api/rest${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
        prefer: "return=representation",
      },
      body: JSON.stringify(body),
    }),
  );
  if (res.status >= 300) throw new Error(`Seed failed: POST ${path} -> ${res.status}`);
  return (await res.json()) as unknown;
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
      json({
        email: "admin@andeshq.dev",
        password: "supersecret123",
        name: "Admin",
        storeName: "Collection Store",
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
}, 120_000);

afterAll(async () => {
  await db?.destroy();
  await h?.dispose();
});

async function makeProduct(input: {
  slug: string;
  status: "active" | "draft";
  price: number;
}): Promise<string> {
  const product = await db
    .withSchema("commerce")
    .insertInto("products")
    .values({ title: input.slug, slug: input.slug, status: input.status })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db
    .withSchema("commerce")
    .insertInto("product_variants")
    .values({ product_id: product.id, title: "Default", price_cents: input.price })
    .execute();
  return product.id;
}

describe("manual collections", () => {
  test("staff curate a collection and the storefront reads it", async () => {
    const live = await makeProduct({ slug: "linen-shirt", status: "active", price: 80000 });
    const draft = await makeProduct({ slug: "secret-tee", status: "draft", price: 90000 });

    const collection = await adminPost("/collections", {
      name: "Summer",
      slug: "summer",
      type: "manual",
      position: 0,
    });
    const collectionId = collection[0].id as string;

    await adminPost("/product_collections", {
      product_id: live,
      collection_id: collectionId,
      position: 0,
    });
    await adminPost("/product_collections", {
      product_id: draft,
      collection_id: collectionId,
      position: 1,
    });

    // Anon sees the collection, but only the active product counts.
    const list = await rest("/storefront_collections?select=slug,name,product_count");
    expect(list.status).toBe(200);
    const summer = (list.body as any[]).find((row) => row.slug === "summer");
    expect(summer).toMatchObject({ name: "Summer", product_count: 1 });

    const page = await rest("/rpc/storefront_collection", json({ p_slug: "summer" }));
    expect(page.status).toBe(200);
    const doc = payload(page.body);
    expect(doc.slug).toBe("summer");
    expect(doc.products).toHaveLength(1);
    expect(doc.products[0]).toMatchObject({
      slug: "linen-shirt",
      price_min_cents: "80000",
      price_max_cents: "80000",
    });
  });

  test("an unknown collection slug returns null", async () => {
    const res = await rest("/rpc/storefront_collection", json({ p_slug: "nope" }));
    expect(res.status).toBe(200);
    expect(payload(res.body)).toBeNull();
  });

  test("anon cannot write collections", async () => {
    const { status } = await rest("/collections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nope", slug: "nope", type: "manual" }),
    });
    expect(status).toBeGreaterThanOrEqual(400);
  });
});
