import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createHarness, type Harness } from "./helpers/harness.ts";
import type { App } from "../src/lib/app.ts";

/**
 * Nested writes: one request should be able to create and update a whole
 * product graph (options + variants + junction rows) in a single transaction.
 */

let h: Harness | undefined;
let app: App;
let adminCookie: string;

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

function write(path: string, method: string, body: unknown) {
  return rest(path, {
    method,
    headers: { "content-type": "application/json", cookie: adminCookie },
    body: JSON.stringify(body),
  });
}

/**
 * PostgREST returns 201 for inserts even without `return=representation`.
 */
function expectCreated(status: number): void {
  expect(status).toBe(201);
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
        storeName: "Nested Store",
      }),
    ),
  );
  adminCookie = await signIn("admin@andeshq.dev", "supersecret123");
}, 120_000);

afterAll(async () => {
  await h?.dispose();
});

describe("nested writes", () => {
  test("one POST creates the option library, then a product graph linking it", async () => {
    const optionName = `Size-${randomUUID().slice(0, 8)}`;

    // Option library: option + values in one nested POST.
    const optionRes = await write("/options", "POST", {
      name: optionName,
      option_values: [
        { value: "S", position: 0 },
        { value: "M", position: 1 },
      ],
    });
    expectCreated(optionRes.status);

    const library = await rest(
      `/options?select=id,option_values(id,value)&name=eq.${optionName}`,
      { headers: { cookie: adminCookie } },
    );
    expect(library.status).toBe(200);
    const optionId = library.body[0].id as string;
    const values: Record<string, string> = Object.fromEntries(
      library.body[0].option_values.map((v: any) => [v.value, v.id]),
    );
    expect(Object.keys(values).sort()).toEqual(["M", "S"]);

    // Product graph: product + option link + variants + variant→value links.
    const slug = `nested-polo-${randomUUID().slice(0, 8)}`;
    const productId = randomUUID();
    const smallId = randomUUID();
    const mediumId = randomUUID();

    const created = await write("/products", "POST", {
      id: productId,
      title: "Nested polo",
      slug,
      status: "draft",
      product_options: [{ option_id: optionId, position: 0 }],
      product_variants: [
        {
          id: smallId,
          title: "S",
          price_cents: 100000,
          position: 0,
          variant_option_values: [{ option_value_id: values.S }],
        },
        {
          id: mediumId,
          title: "M",
          price_cents: 110000,
          position: 1,
          variant_option_values: [{ option_value_id: values.M }],
        },
      ],
    });
    expectCreated(created.status);

    const read = await rest(
      `/products?select=title,options:product_options(option:options(name)),` +
        `variants:product_variants(id,title,price_cents::text,values:variant_option_values(option_value:option_values(value)))` +
        `&slug=eq.${slug}`,
      { headers: { cookie: adminCookie } },
    );
    expect(read.status).toBe(200);
    expect(read.body).toEqual([
      {
        title: "Nested polo",
        options: [{ option: { name: optionName } }],
        variants: [
          {
            id: smallId,
            title: "S",
            price_cents: "100000",
            values: [{ option_value: { value: "S" } }],
          },
          {
            id: mediumId,
            title: "M",
            price_cents: "110000",
            values: [{ option_value: { value: "M" } }],
          },
        ],
      },
    ]);

    // One PATCH updates prices, adds a variant and re-links option values
    // idempotently (the many-to-many shape ensures junction rows). New related
    // rows must omit their primary key: an element that carries the key is an
    // update, and a missing row is an error rather than an upsert.
    const patched = await rest(`/products?id=eq.${productId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        title: "Nested polo v2",
        options: [{ id: optionId }],
        product_variants: [
          {
            id: smallId,
            price_cents: 120000,
            option_values: [{ id: values.S }],
          },
          {
            title: "L",
            price_cents: 130000,
            position: 2,
            variant_option_values: [{ option_value_id: values.M }],
          },
        ],
      }),
    });
    expect(patched.status).toBeLessThan(300);

    const after = await rest(
      `/products?select=title,variants:product_variants(id,title,price_cents::text)&slug=eq.${slug}`,
      { headers: { cookie: adminCookie } },
    );
    expect(after.body[0].title).toBe("Nested polo v2");
    expect(
      after.body[0].variants.map((v: any) => ({ title: v.title, price_cents: v.price_cents })),
    ).toEqual([
      { title: "S", price_cents: "120000" },
      { title: "M", price_cents: "110000" },
      { title: "L", price_cents: "130000" },
    ]);
  });
});
