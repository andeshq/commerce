import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHarness, type Harness } from "./helpers/harness.ts";
import type { App } from "../src/lib/app.ts";

/**
 * Additional info sections: product-scoped rich-text blocks. Staff write; anon
 * reads them only for active products; the storefront product RPC carries them.
 */

let h: Harness | undefined;
let app: App;
let adminCookie: string;
let activeProductId: string;
let draftProductId: string;

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

async function adminPost(path: string, body: unknown): Promise<void> {
  const { status } = await rest(path, json(body, adminCookie));
  if (status >= 300) throw new Error(`Seed failed: POST ${path} -> ${status}`);
}

function payload(body: any): any {
  return Array.isArray(body) ? body[0] : body;
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
        storeName: "Info Store",
      }),
    ),
  );
  adminCookie = cookieFrom(
    await app.fetch(
      new Request(
        "http://localhost/api/auth/sign-in/email",
        json({ email: "admin@andeshq.dev", password: "supersecret123" }),
      ),
    ),
  );

  await adminPost("/products", { title: "Live shirt", slug: "live-shirt", status: "active" });
  await adminPost("/products", { title: "Draft shirt", slug: "draft-shirt", status: "draft" });

  const products = await rest("/products?select=id,slug", { headers: { cookie: adminCookie } });
  activeProductId = products.body.find((p: any) => p.slug === "live-shirt").id;
  draftProductId = products.body.find((p: any) => p.slug === "draft-shirt").id;
}, 120_000);

afterAll(async () => {
  await h?.dispose();
});

describe("product info sections", () => {
  test("admin creates sections with a title and rich text", async () => {
    await adminPost("/product_info_sections", {
      product_id: activeProductId,
      title: "Return & Refund Policy",
      body: "<p>30 días para devoluciones.</p>",
      position: 0,
    });
    await adminPost("/product_info_sections", {
      product_id: activeProductId,
      title: "Shipping Info",
      body: "<p>Envíos a todo el país.</p>",
      position: 1,
    });

    const { status, body } = await rest(
      `/product_info_sections?select=title,body,position&product_id=eq.${activeProductId}&order=position.asc`,
      { headers: { cookie: adminCookie } },
    );
    expect(status).toBe(200);
    expect(body).toEqual([
      { title: "Return & Refund Policy", body: "<p>30 días para devoluciones.</p>", position: 0 },
      { title: "Shipping Info", body: "<p>Envíos a todo el país.</p>", position: 1 },
    ]);
  });

  test("anon reads sections of an active product", async () => {
    const { status, body } = await rest(
      `/product_info_sections?select=title&product_id=eq.${activeProductId}&order=position.asc`,
    );
    expect(status).toBe(200);
    expect(body).toEqual([{ title: "Return & Refund Policy" }, { title: "Shipping Info" }]);
  });

  test("anon cannot read a draft product's sections", async () => {
    await adminPost("/product_info_sections", {
      product_id: draftProductId,
      title: "Hidden",
      position: 0,
    });
    const { body } = await rest(
      `/product_info_sections?select=title&product_id=eq.${draftProductId}`,
    );
    expect(body).toEqual([]);
  });

  test("staff still sees a draft product's sections", async () => {
    const { body } = await rest(
      `/product_info_sections?select=title&product_id=eq.${draftProductId}`,
      { headers: { cookie: adminCookie } },
    );
    expect(body).toEqual([{ title: "Hidden" }]);
  });

  test("anon cannot write", async () => {
    const { status } = await rest("/product_info_sections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ product_id: activeProductId, title: "Hacked" }),
    });
    expect(status).toBe(401);
  });

  test("admin reorders and updates a section", async () => {
    const before = await rest(
      `/product_info_sections?select=id,title&product_id=eq.${activeProductId}&order=position.asc`,
      { headers: { cookie: adminCookie } },
    );
    const rows = before.body as Array<{ id: string; title: string }>;
    const first = rows[0]!;
    const second = rows[1]!;

    const updated = await rest(`/product_info_sections?id=eq.${second.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ title: "Shipping & Returns", position: 0 }),
    });
    expect(updated.status).toBeLessThan(300);

    // Move the other row down so the display order is unambiguous.
    const shifted = await rest(`/product_info_sections?id=eq.${first.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ position: 1 }),
    });
    expect(shifted.status).toBeLessThan(300);

    const after = await rest(
      `/product_info_sections?select=title&product_id=eq.${activeProductId}&order=position.asc`,
      { headers: { cookie: adminCookie } },
    );
    expect(after.body).toEqual([{ title: "Shipping & Returns" }, { title: first.title }]);
  });

  test("storefront_product carries the sections", async () => {
    const { status, body } = await rest("/rpc/storefront_product", json({ p_slug: "live-shirt" }));
    expect(status).toBe(200);
    const product = payload(body);
    expect(product.info_sections).toEqual([
      { id: expect.any(String), title: "Shipping & Returns", body: "<p>Envíos a todo el país.</p>" },
      { id: expect.any(String), title: "Return & Refund Policy", body: "<p>30 días para devoluciones.</p>" },
    ]);
  });

  test("deleting a product cascades to its sections", async () => {
    const removed = await rest(`/products?id=eq.${draftProductId}`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    });
    expect(removed.status).toBeLessThan(300);

    const { body } = await rest(
      `/product_info_sections?select=title&product_id=eq.${draftProductId}`,
      { headers: { cookie: adminCookie } },
    );
    expect(body).toEqual([]);
  });
});
