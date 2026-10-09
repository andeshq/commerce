import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";
import { createHarness, type Harness } from "./helpers/harness.ts";
import { createMigrationDatabase } from "../src/database/migrator.ts";
import type { App } from "../src/lib/app.ts";

/**
 * RLS authorization matrix, exercised through the real HTTP surface
 * (auth -> pgbase -> SET LOCAL ROLE -> RLS). This is the security core of the
 * platform: a regression here is a privilege-escalation bug.
 */

let h: Harness | undefined;
let app: App;
let adminCookie: string;
let customerCookie: string;
let staffCookie: string;
let liveVariantId: string;
let inventoryLocationId: string;

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
  const set = res.headers.get("set-cookie") ?? "";
  return set.split(";")[0] ?? "";
}

async function signIn(email: string, password: string): Promise<string> {
  const res = await app.fetch(
    new Request("http://localhost/api/auth/sign-in/email", json({ email, password })),
  );
  return cookieFrom(res);
}

async function rest(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
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

beforeAll(async () => {
  h = await createHarness();
  const databaseUrl = await h.createDatabase();
  app = await h.app(databaseUrl);

  // First-run bootstrap creates the admin + store.
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

  // Admin seeds products (active + draft) and inventory.
  await rest("/products", {
    ...json(
      [
        { title: "Live", slug: "live", status: "active" },
        { title: "Hidden", slug: "hidden", status: "draft" },
      ],
      adminCookie,
    ),
  });

  const products = await rest("/products?select=id&slug=eq.live", {
    headers: { cookie: adminCookie },
  });
  const liveProductId = (products.body as Array<{ id: string }>)[0]?.id;
  if (!liveProductId) throw new Error("Failed to seed live product");

  await rest("/product_variants", {
    ...json(
      {
        product_id: liveProductId,
        sku: "live-sku",
        title: "Live variant",
        price_cents: 12500,
      },
      adminCookie,
    ),
  });
  const variants = await rest("/product_variants?select=id&sku=eq.live-sku", {
    headers: { cookie: adminCookie },
  });
  liveVariantId = (variants.body as Array<{ id: string }>)[0]?.id ?? "";
  if (!liveVariantId) throw new Error("Failed to seed live variant");

  await rest("/inventory_locations", {
    ...json({ name: "Main warehouse", code: "WAREHOUSE" }, adminCookie),
  });
  const locations = await rest("/inventory_locations?select=id&code=eq.WAREHOUSE", {
    headers: { cookie: adminCookie },
  });
  inventoryLocationId = (locations.body as Array<{ id: string }>)[0]?.id ?? "";
  if (!inventoryLocationId) throw new Error("Failed to seed inventory location");

  const inventoryDb = createMigrationDatabase(databaseUrl);
  try {
    // Stock writes are function-only now, so seed the level as the owner.
    await sql`
      insert into commerce.inventory_levels (variant_id, location_id, available)
      values (${liveVariantId}, ${inventoryLocationId}, 7)
    `.execute(inventoryDb);
  } finally {
    await inventoryDb.destroy();
  }

  // A customer signs up (default role) and signs in.
  await app.fetch(
    new Request(
      "http://localhost/api/auth/sign-up/email",
      json({ email: "buyer@andeshq.dev", password: "supersecret123", name: "Buyer" }),
    ),
  );
  customerCookie = await signIn("buyer@andeshq.dev", "supersecret123");

  await app.fetch(
    new Request(
      "http://localhost/api/auth/sign-up/email",
      json({ email: "staff@andeshq.dev", password: "supersecret123", name: "Staff" }),
    ),
  );
  const authDb = createMigrationDatabase(databaseUrl);
  try {
    await sql`update auth."user" set role = 'staff' where email = 'staff@andeshq.dev'`.execute(
      authDb,
    );
  } finally {
    await authDb.destroy();
  }
  staffCookie = await signIn("staff@andeshq.dev", "supersecret123");
}, 120_000);

afterAll(async () => {
  await h?.dispose();
});

describe("RLS: products", () => {
  test("anon reads only active products", async () => {
    const { body } = await rest("/products?select=slug&order=slug");
    expect(body).toEqual([{ slug: "live" }]);
  });

  test("customer reads only active products", async () => {
    const { body } = await rest("/products?select=slug&order=slug", {
      headers: { cookie: customerCookie },
    });
    expect(body).toEqual([{ slug: "live" }]);
  });

  test("admin reads active and draft products", async () => {
    const { body } = await rest("/products?select=slug&order=slug", {
      headers: { cookie: adminCookie },
    });
    expect(body).toEqual([{ slug: "hidden" }, { slug: "live" }]);
  });

  test("staff reads active and draft products", async () => {
    const { body } = await rest("/products?select=slug&order=slug", {
      headers: { cookie: staffCookie },
    });
    expect(body).toEqual([{ slug: "hidden" }, { slug: "live" }]);
  });
});

describe("RLS: writes", () => {
  test("anon cannot insert a product (401)", async () => {
    const { status } = await rest("/products", {
      ...json({ title: "Nope", slug: "nope", status: "active" }),
    });
    expect(status).toBe(401);
  });

  test("customer cannot insert a product (403)", async () => {
    const { status } = await rest("/products", {
      ...json({ title: "Nope", slug: "nope2", status: "active" }, customerCookie),
    });
    expect(status).toBe(403);
  });

  test("admin can insert a product", async () => {
    const { status } = await rest("/products", {
      ...json({ title: "New", slug: "new", status: "draft" }, adminCookie),
    });
    expect(status).toBeLessThan(300);
  });

  test("staff can insert a product", async () => {
    const { status } = await rest("/products", {
      ...json({ title: "Staff product", slug: "staff-product", status: "draft" }, staffCookie),
    });
    expect(status).toBeLessThan(300);
  });
});

describe("RLS: inventory is staff-only", () => {
  test("anon sees no inventory levels", async () => {
    const { body } = await rest("/inventory_levels?select=variant_id");
    expect(body).toEqual([]);
  });

  test("customer sees no inventory levels", async () => {
    const { body } = await rest("/inventory_levels?select=variant_id", {
      headers: { cookie: customerCookie },
    });
    expect(body).toEqual([]);
  });

  test("staff can read inventory levels", async () => {
    const { body } = await rest("/inventory_levels?select=available", {
      headers: { cookie: staffCookie },
    });
    expect(body).toEqual([{ available: 7 }]);
  });

  test("customer cannot update inventory levels", async () => {
    const { status } = await rest(
      `/inventory_levels?variant_id=eq.${liveVariantId}&location_id=eq.${inventoryLocationId}`,
      {
        ...json({ available: 99 }, customerCookie),
        method: "PATCH",
      },
    );
    expect(status).toBe(403);
  });

  test("staff cannot update inventory levels directly", async () => {
    const { status } = await rest(
      `/inventory_levels?variant_id=eq.${liveVariantId}&location_id=eq.${inventoryLocationId}`,
      {
        ...json({ available: 8 }, staffCookie),
        method: "PATCH",
      },
    );
    expect(status).toBe(403);
  });
});

describe("RLS: store settings", () => {
  test("anon can read settings", async () => {
    const { body } = await rest("/store_settings?select=name");
    expect(body).toEqual([{ name: "Test Store" }]);
  });

  test("anon cannot update settings (401)", async () => {
    const { status } = await rest("/store_settings?id=is.true", {
      ...json({ name: "Hacked" }),
      method: "PATCH",
    });
    expect(status).toBe(401);
  });

  test("admin can update settings", async () => {
    const { status } = await rest("/store_settings?id=is.true", {
      ...json({ name: "Renamed" }, adminCookie),
      method: "PATCH",
    });
    expect(status).toBeLessThan(300);
  });

  test("staff cannot update settings", async () => {
    const { status } = await rest("/store_settings?id=is.true", {
      ...json({ name: "Staff edit" }, staffCookie),
      method: "PATCH",
    });
    expect(status).toBe(403);
  });
});
