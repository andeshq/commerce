import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHarness, type Harness } from "./helpers/harness.ts";
import type { App } from "../src/lib/app.ts";

/**
 * Storefront reads through pgbase: relationship embedding under RLS, and proof
 * that the public product shape never carries private COGS data.
 */

let h: Harness | undefined;
let app: App;
let adminCookie: string;
let activeProductId: string;
let draftProductId: string;
let variantId: string;
let variantOptionValueId: string;

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
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
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
): Promise<{ status: number; body: any }> {
  const res = await app.fetch(new Request(`http://localhost/api/rest${path}`, init));
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

async function adminPost(path: string, body: unknown): Promise<void> {
  const { status } = await rest(path, json(body, adminCookie));
  if (status >= 300) throw new Error(`Seed failed: POST ${path} -> ${status}`);
}

beforeAll(async () => {
  h = await createHarness();
  app = await h.app();

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
  adminCookie = await signIn("admin@andeshq.dev", "supersecret123");

  await adminPost("/categories", { name: "Shirts", slug: "shirts" });
  const categories = await rest("/categories?select=id&slug=eq.shirts", {
    headers: { cookie: adminCookie },
  });

  await adminPost("/products", {
    title: "Live shirt",
    slug: "live-shirt",
    status: "active",
    vendor: "Andes",
    category_id: categories.body[0].id,
  });
  await adminPost("/products", {
    title: "Hidden shirt",
    slug: "hidden-shirt",
    status: "draft",
  });

  const products = await rest("/products?select=id,slug", {
    headers: { cookie: adminCookie },
  });
  activeProductId = products.body.find((p: any) => p.slug === "live-shirt").id;
  draftProductId = products.body.find((p: any) => p.slug === "hidden-shirt").id;

  await adminPost("/product_variants", {
    product_id: activeProductId,
    sku: "LIVE-M",
    title: "Medium",
    price_cents: 129900,
    compare_at_price_cents: 159900,
  });
  await adminPost("/product_variants", {
    product_id: draftProductId,
    sku: "HIDDEN-M",
    title: "Medium",
    price_cents: 99000,
  });
  const variants = await rest("/product_variants?select=id,sku", {
    headers: { cookie: adminCookie },
  });
  variantId = variants.body.find((v: any) => v.sku === "LIVE-M").id;

  // Private cost data: staff-only table.
  await adminPost("/product_variant_costs", { variant_id: variantId, cost_cents: 61000 });

  await adminPost("/options", { name: "Size" });
  const options = await rest("/options?select=id&name=eq.Size", {
    headers: { cookie: adminCookie },
  });
  const optionId = options.body[0].id;
  await adminPost("/option_values", { option_id: optionId, value: "M" });
  const optionValues = await rest(`/option_values?select=id&option_id=eq.${optionId}`, {
    headers: { cookie: adminCookie },
  });
  variantOptionValueId = optionValues.body[0].id;
  await adminPost("/product_options", { product_id: activeProductId, option_id: optionId });
  await adminPost("/variant_option_values", {
    variant_id: variantId,
    option_value_id: optionValues.body[0].id,
  });

  await adminPost("/media", { url: "https://cdn.example.com/shirt.jpg", alt: "Shirt" });
  const media = await rest("/media?select=id", { headers: { cookie: adminCookie } });
  await adminPost("/product_media", {
    product_id: activeProductId,
    media_id: media.body[0].id,
  });
}, 120_000);

afterAll(async () => {
  await h?.dispose();
});

describe("storefront reads: embedding", () => {
  test("anon reads active products with embedded variants", async () => {
    // Embedded bigints are serialized by Postgres `json_agg` as JSON numbers,
    // which would lose precision. Cast money columns to text so the wire format
    // matches the top-level bigint-as-string behavior.
    const { body } = await rest(
      "/products?select=title,variants:product_variants(sku,price_cents::text)&slug=eq.live-shirt",
    );
    expect(body).toEqual([
      { title: "Live shirt", variants: [{ sku: "LIVE-M", price_cents: "129900" }] },
    ]);
  });

  test("anon embeds media via the product_media junction", async () => {
    const { body } = await rest(
      "/products?select=title,media:media(url,alt)&slug=eq.live-shirt",
    );
    expect(body).toEqual([
      {
        title: "Live shirt",
        media: [{ url: "https://cdn.example.com/shirt.jpg", alt: "Shirt" }],
      },
    ]);
  });

  test("anon embeds nested option values through the link table", async () => {
    const { body } = await rest(
      "/products?select=title,options:product_options(option:options(name,values:option_values(value)))&slug=eq.live-shirt",
    );
    expect(body).toEqual([
      {
        title: "Live shirt",
        options: [{ option: { name: "Size", values: [{ value: "M" }] } }],
      },
    ]);
  });

  test("anon embeds a variant's option values", async () => {
    const { body } = await rest(
      "/products?select=title,variants:product_variants(sku,values:variant_option_values(value:option_values(value)))&slug=eq.live-shirt",
    );
    expect(body).toEqual([
      {
        title: "Live shirt",
        variants: [{ sku: "LIVE-M", values: [{ value: { value: "M" } }] }],
      },
    ]);
  });

  test("anon reads the shared option library", async () => {
    const { status, body } = await rest("/options?select=name&order=name.asc");
    expect(status).toBe(200);
    expect(body).toEqual([{ name: "Size" }]);
  });

  test("anon cannot write to the option library", async () => {
    const { status } = await rest("/options", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Hacked" }),
    });
    expect(status).toBe(401);
  });
});

describe("storefront reads: visibility", () => {
  test("anon cannot see draft products", async () => {
    const { body } = await rest("/products?select=slug&slug=eq.hidden-shirt");
    expect(body).toEqual([]);
  });

  test("anon cannot see a draft product's variants", async () => {
    const { body } = await rest(
      `/product_variants?select=sku&product_id=eq.${draftProductId}`,
    );
    expect(body).toEqual([]);
  });
});

describe("storefront reads: catalog view", () => {
  test("anon reads active variants with money as text", async () => {
    const { status, body } = await rest(
      "/catalog_variants?select=product_slug,sku,price_cents,compare_at_price_cents&order=sku.asc",
    );
    expect(status).toBe(200);
    expect(body).toEqual([
      {
        product_slug: "live-shirt",
        sku: "LIVE-M",
        price_cents: "129900",
        compare_at_price_cents: "159900",
      },
    ]);
  });

  test("anon cannot see draft variants through the view", async () => {
    const { body } = await rest("/catalog_variants?select=sku&sku=eq.HIDDEN-M");
    expect(body).toEqual([]);
  });

  test("staff sees every variant through the view", async () => {
    const { body } = await rest("/catalog_variants?select=sku&order=sku.asc", {
      headers: { cookie: adminCookie },
    });
    expect(body).toEqual([{ sku: "HIDDEN-M" }, { sku: "LIVE-M" }]);
  });

  test("anon embeds a variant's option values through the view", async () => {
    const { body } = await rest(
      "/catalog_variants?select=sku,values:variant_option_values(value:option_values(value))&sku=eq.LIVE-M",
    );
    expect(body).toEqual([{ sku: "LIVE-M", values: [{ value: { value: "M" } }] }]);
  });

  test("anon embeds the view under a product", async () => {
    const { body } = await rest(
      "/products?select=title,variants:catalog_variants(sku,price_cents)&slug=eq.live-shirt",
    );
    expect(body).toEqual([
      { title: "Live shirt", variants: [{ sku: "LIVE-M", price_cents: "129900" }] },
    ]);
  });

  test("anon embeds through the view into deeper relations", async () => {
    const { body } = await rest(
      "/products?select=title,variants:catalog_variants(sku,values:variant_option_values(option_value_id))&slug=eq.live-shirt",
    );
    expect(body).toEqual([
      {
        title: "Live shirt",
        variants: [
          {
            sku: "LIVE-M",
            values: [{ option_value_id: variantOptionValueId }],
          },
        ],
      },
    ]);
  });
});

describe("storefront reads: private cost stays private", () => {
  test("anon select=* on variants has no cost field", async () => {
    const { status, body } = await rest("/product_variants?select=*&sku=eq.LIVE-M");
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(Object.keys(body[0])).not.toContain("cost_cents");
  });

  test("embedded variants with * expose no cost field", async () => {
    const { body } = await rest(
      "/products?select=title,variants:product_variants(*)&slug=eq.live-shirt",
    );
    expect(Object.keys(body[0].variants[0])).not.toContain("cost_cents");
  });

  test("anon is denied the cost table", async () => {
    const { status } = await rest("/product_variant_costs?select=cost_cents");
    expect(status).toBe(401);
  });

  test("admin can read cost", async () => {
    const { status, body } = await rest(
      `/product_variant_costs?select=cost_cents&variant_id=eq.${variantId}`,
      { headers: { cookie: adminCookie } },
    );
    expect(status).toBe(200);
    expect(body).toEqual([{ cost_cents: "61000" }]);
  });
});
