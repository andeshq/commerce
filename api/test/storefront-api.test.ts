import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHarness, type Harness } from "./helpers/harness.ts";
import { createMigrationDatabase } from "../src/database/migrator.ts";
import type { App } from "../src/lib/app.ts";

/**
 * The curated storefront surface: `storefront_products` / `storefront_categories`
 * views (RLS-driven visibility) and the `storefront_product(slug)` detail RPC.
 */

let h: Harness | undefined;
let app: App;
let db: ReturnType<typeof createMigrationDatabase>;
let adminCookie: string;
let activeProductId: string;
let activeVariantId: string;
let draftProductId: string;
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
  const res = await app.fetch(new Request(`http://localhost/api/rest${path}`, init));
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

async function adminPost(path: string, body: unknown): Promise<any> {
  const { status, body: out } = await rest(path, json(body, adminCookie));
  if (status >= 300) throw new Error(`Seed failed: POST ${path} -> ${status} ${JSON.stringify(out)}`);
  return out;
}

async function rpc(name: string, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  return rest(`/rpc/${name}`, json(body));
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
        storeName: "Storefront Store",
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

  await adminPost("/categories", { name: "Shirts", slug: "shirts" });
  const categories = await rest("/categories?select=id&slug=eq.shirts", {
    headers: { cookie: adminCookie },
  });
  const categoryId = categories.body[0].id as string;

  await adminPost("/products", {
    title: "Camiseta Andina",
    slug: "camiseta-andina",
    status: "active",
    vendor: "Andes",
    category_id: categoryId,
    description: "Algodón pima peruano.",
  });
  await adminPost("/products", {
    title: "Camiseta Oculta",
    slug: "camiseta-oculta",
    status: "draft",
    vendor: "Andes",
  });

  const products = await rest("/products?select=id,slug", { headers: { cookie: adminCookie } });
  activeProductId = products.body.find((p: any) => p.slug === "camiseta-andina").id;
  draftProductId = products.body.find((p: any) => p.slug === "camiseta-oculta").id;

  await adminPost("/product_variants", {
    product_id: activeProductId,
    sku: "AND-M",
    title: "Medium",
    price_cents: 129900,
    compare_at_price_cents: 159900,
  });
  await adminPost("/product_variants", {
    product_id: draftProductId,
    sku: "OCU-M",
    title: "Medium",
    price_cents: 99000,
  });
  const variants = await rest("/product_variants?select=id,sku", { headers: { cookie: adminCookie } });
  activeVariantId = variants.body.find((v: any) => v.sku === "AND-M").id;

  await adminPost("/media", { url: "/media/andina.jpg", alt: "Camiseta Andina" });
  const media = await rest("/media?select=id&alt=eq.Camiseta%20Andina", {
    headers: { cookie: adminCookie },
  });
  await adminPost("/product_media", { product_id: activeProductId, media_id: media.body[0].id });

  await adminPost("/options", { name: "Size" });
  const options = await rest("/options?select=id&name=eq.Size", {
    headers: { cookie: adminCookie },
  });
  const optionId = options.body[0].id as string;
  await adminPost("/option_values", { option_id: optionId, value: "M" });
  const optionValues = await rest(`/option_values?select=id&option_id=eq.${optionId}`, {
    headers: { cookie: adminCookie },
  });
  await adminPost("/product_options", { product_id: activeProductId, option_id: optionId });
  await adminPost("/variant_option_values", {
    variant_id: activeVariantId,
    option_value_id: optionValues.body[0].id,
  });

  await adminPost("/modifier_groups", { name: "Personalización" });
  const groups = await rest("/modifier_groups?select=id&name=eq.Personalizaci%C3%B3n", {
    headers: { cookie: adminCookie },
  });
  const groupId = groups.body[0].id as string;
  await adminPost("/modifier_values", {
    group_id: groupId,
    name: "Bordado",
    price_delta_cents: 1000000,
  });
  await adminPost("/product_modifier_groups", { product_id: activeProductId, group_id: groupId });

  const adjust = await rest("/rpc/adjust_inventory", {
    ...json(
      { variant: activeVariantId, location: locationId, reason: "stock_received", quantity: 10 },
      adminCookie,
    ),
  });
  if (adjust.status >= 300) throw new Error(`Seed stock failed: ${adjust.status}`);
}, 120_000);

afterAll(async () => {
  await db?.destroy();
  await h?.dispose();
});

describe("storefront_products view", () => {
  test("anon sees active products with price range, image and stock", async () => {
    const { status, body } = await rest(
      "/storefront_products?select=slug,title,vendor,price_min_cents,price_max_cents,compare_at_min_cents,variant_count,in_stock,image_url,category_slug&slug=eq.camiseta-andina",
    );
    expect(status).toBe(200);
    expect(body).toEqual([
      {
        slug: "camiseta-andina",
        title: "Camiseta Andina",
        vendor: "Andes",
        price_min_cents: "129900",
        price_max_cents: "129900",
        compare_at_min_cents: "159900",
        variant_count: 1,
        in_stock: true,
        image_url: "/media/andina.jpg",
        category_slug: "shirts",
      },
    ]);
  });

  test("anon cannot see draft products", async () => {
    const { body } = await rest("/storefront_products?select=slug&slug=eq.camiseta-oculta");
    expect(body).toEqual([]);
  });

  test("staff see drafts through the same view", async () => {
    const { body } = await rest("/storefront_products?select=slug&slug=eq.camiseta-oculta", {
      headers: { cookie: adminCookie },
    });
    expect(body).toEqual([{ slug: "camiseta-oculta" }]);
  });

  test("in_stock flips when the shelf empties", async () => {
    const adjust = await rest("/rpc/adjust_inventory", {
      ...json(
        {
          variant: activeVariantId,
          location: locationId,
          reason: "inventory_recount",
          quantity: 0,
        },
        adminCookie,
      ),
    });
    expect(adjust.status).toBe(200);

    const { body } = await rest(
      "/storefront_products?select=in_stock&slug=eq.camiseta-andina",
    );
    expect(body).toEqual([{ in_stock: false }]);

    // Restock for the remaining tests.
    await rest("/rpc/adjust_inventory", {
      ...json(
        { variant: activeVariantId, location: locationId, reason: "stock_received", quantity: 5 },
        adminCookie,
      ),
    });
  });

  test("full-text search matches via the search column", async () => {
    const { status, body } = await rest(
      "/storefront_products?select=slug&search=plfts(spanish).camiseta&order=slug.asc",
    );
    expect(status).toBe(200);
    expect(body).toEqual([{ slug: "camiseta-andina" }]);
  });

  test("ordering and limiting work", async () => {
    const { body } = await rest(
      "/storefront_products?select=slug&order=price_min_cents.asc&limit=1",
    );
    expect(body).toEqual([{ slug: "camiseta-andina" }]);
  });
});

describe("storefront_categories view", () => {
  test("product_count excludes drafts for anon", async () => {
    const { body } = await rest(
      "/storefront_categories?select=name,slug,product_count&slug=eq.shirts",
    );
    expect(body).toEqual([{ name: "Shirts", slug: "shirts", product_count: 1 }]);
  });
});

describe("storefront_product rpc", () => {
  test("returns the full product page for a visible slug", async () => {
    const { status, body } = await rpc("storefront_product", { p_slug: "camiseta-andina" });
    expect(status).toBe(200);
    const product = payload(body);
    expect(product).toMatchObject({
      slug: "camiseta-andina",
      title: "Camiseta Andina",
      vendor: "Andes",
    });
    expect(product.variants).toHaveLength(1);
    expect(product.variants[0]).toMatchObject({
      sku: "AND-M",
      price_cents: "129900",
      compare_at_price_cents: "159900",
      in_stock: true,
    });
    expect(product.variants[0].option_values).toEqual([
      { option_id: expect.any(String), option_name: "Size", value: "M" },
    ]);
    expect(product.options).toHaveLength(1);
    expect(product.options[0].name).toBe("Size");
    expect(product.options[0].values).toEqual([{ id: expect.any(String), value: "M" }]);
    expect(product.modifiers).toHaveLength(1);
    expect(product.modifiers[0].name).toBe("Personalización");
    expect(product.modifiers[0].values[0]).toMatchObject({
      name: "Bordado",
      price_delta_cents: "1000000",
    });
    expect(product.media).toEqual([
      { url: "/media/andina.jpg", alt: "Camiseta Andina", width: null, height: null },
    ]);
  });

  test("returns null for a draft slug", async () => {
    const { status, body } = await rpc("storefront_product", { p_slug: "camiseta-oculta" });
    expect(status).toBe(200);
    expect(payload(body)).toBeNull();
  });
});
