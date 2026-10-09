import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHarness, type Harness } from "./helpers/harness.ts";
import { createMigrationDatabase } from "../src/database/migrator.ts";
import type { App } from "../src/lib/app.ts";

/**
 * Bootstrap lock semantics: `/api/setup` is open exactly until the first admin
 * exists, then refuses forever.
 */

let h: Harness | undefined;
let app: App;
let db: ReturnType<typeof createMigrationDatabase>;

async function post(path: string, body: unknown): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const validPayload = {
  email: "owner@andeshq.dev",
  password: "supersecret123",
  name: "Owner",
  storeName: "Andes",
};

beforeAll(async () => {
  h = await createHarness();
  const databaseUrl = await h.createDatabase();
  app = await h.app(databaseUrl);
  db = createMigrationDatabase(databaseUrl);
}, 120_000);

afterAll(async () => {
  await db?.destroy();
  await h?.dispose();
});

describe("bootstrap", () => {
  test("reports needsSetup before setup", async () => {
    const res = await app.fetch(new Request("http://localhost/api/setup/status"));
    expect(await res.json()).toEqual({ needsSetup: true });
  });

  test("rejects an invalid payload with 400", async () => {
    const res = await post("/api/setup", { email: "bad" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });

  test("creates the first admin and store settings", async () => {
    const res = await post("/api/setup", validPayload);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      user: { email: string };
      store: {
        name: string;
        currencyCode: string;
        locale: string;
        pricesIncludeTax: boolean;
      };
    };
    expect(body.user.email).toBe("owner@andeshq.dev");
    expect(body.store).toEqual({
      name: "Andes",
      currencyCode: "COP",
      locale: "es-CO",
      pricesIncludeTax: true,
    });
  });

  test("creates a default inventory location named in the store locale", async () => {
    const locations = await db
      .withSchema("commerce")
      .selectFrom("inventory_locations")
      .select(["name", "code", "active"])
      .execute();
    // The payload above takes the default `es-CO` locale.
    expect(locations).toEqual([{ name: "Tienda principal", code: "MAIN", active: true }]);
  });

  test("flips needsSetup to false", async () => {
    const res = await app.fetch(new Request("http://localhost/api/setup/status"));
    expect(await res.json()).toEqual({ needsSetup: false });
  });

  test("refuses a second setup with 409", async () => {
    const res = await post("/api/setup", {
      ...validPayload,
      email: "other@andeshq.dev",
    });
    expect(res.status).toBe(409);
  });

  test("did not create the second user", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "other@andeshq.dev",
          password: "supersecret123",
        }),
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
