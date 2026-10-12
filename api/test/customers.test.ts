import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";
import { createHarness, type Harness } from "./helpers/harness.ts";
import { createMigrationDatabase } from "../src/database/migrator.ts";
import type { App } from "../src/lib/app.ts";

/**
 * Customer management over Better Auth's admin plugin: admin-only access, the
 * role=customer filter that separates storefront accounts from the team, and
 * suspension. Also checks the FK guarantee that removing an account leaves its
 * orders intact.
 */

const PASSWORD = "supersecret123";

let h: Harness | undefined;

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

async function parse(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

describe("customer management", () => {
  let app: App;
  let db: ReturnType<typeof createMigrationDatabase>;
  let adminCookie: string;
  let staffCookie: string;

  async function get(path: string, cookie?: string) {
    const res = await app.fetch(
      new Request(`http://localhost/api/auth/admin/${path}`, {
        headers: cookie ? { cookie } : {},
      }),
    );
    return { status: res.status, body: await parse(res) };
  }

  async function post(path: string, body: unknown, cookie?: string) {
    const res = await app.fetch(
      new Request(`http://localhost/api/auth/admin/${path}`, json(body, cookie)),
    );
    return { status: res.status, body: await parse(res) };
  }

  async function signIn(email: string, password = PASSWORD) {
    const res = await app.fetch(
      new Request(
        "http://localhost/api/auth/sign-in/email",
        json({ email, password }),
      ),
    );
    return { status: res.status, cookie: cookieFrom(res) };
  }

  async function signUp(email: string) {
    await app.fetch(
      new Request(
        "http://localhost/api/auth/sign-up/email",
        json({ email, password: PASSWORD, name: email.split("@")[0] }),
      ),
    );
  }

  async function userId(email: string): Promise<string> {
    const rows = await sql<{ id: string }>`
      select id from auth."user" where email = ${email}
    `.execute(db);
    return rows.rows[0]!.id;
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
          password: PASSWORD,
          name: "Admin",
          storeName: "Customers Store",
        }),
      ),
    );
    adminCookie = (await signIn("admin@andeshq.dev")).cookie;

    // A staff account, so we can prove the page is admin-only.
    await post(
      "create-user",
      { email: "staff@andeshq.dev", password: PASSWORD, name: "Staff", role: "staff" },
      adminCookie,
    );
    staffCookie = (await signIn("staff@andeshq.dev")).cookie;

    await signUp("ana@example.com");
    await signUp("luis@example.com");
  });

  test("the role filter returns customers only", async () => {
    const { status, body } = await get(
      "list-users?filterField=role&filterValue=customer",
      adminCookie,
    );
    expect(status).toBe(200);
    expect(body.users.length).toBe(2);
    expect(body.users.every((u: any) => u.role === "customer")).toBe(true);
    expect(body.users.some((u: any) => u.email === "ana@example.com")).toBe(true);
    expect(body.users.some((u: any) => u.email === "admin@andeshq.dev")).toBe(false);
  });

  test("anonymous and staff cannot list customers", async () => {
    const path = "list-users?filterField=role&filterValue=customer";
    expect((await get(path)).status).toBe(401);
    expect((await get(path, staffCookie)).status).toBe(403);
  });

  test("suspending blocks sign-in until reactivated", async () => {
    const id = await userId("ana@example.com");

    const suspended = await post("ban-user", { userId: id, banReason: "abuse" }, adminCookie);
    expect(suspended.status).toBe(200);
    expect(suspended.body.user.banned).toBe(true);
    expect((await signIn("ana@example.com")).status).toBeGreaterThanOrEqual(400);

    const active = await post("unban-user", { userId: id }, adminCookie);
    expect(active.status).toBe(200);
    expect((await signIn("ana@example.com")).cookie).not.toBe("");
  });

  test("removing a customer keeps their orders (customer_id set null)", async () => {
    const id = await userId("luis@example.com");

    const inserted = await sql<{ id: string }>`
      insert into commerce.orders (customer_id, email, currency_code)
      values (${id}, 'luis@example.com', 'COP')
      returning id
    `.execute(db);
    const orderId = inserted.rows[0]!.id;

    expect((await post("remove-user", { userId: id }, adminCookie)).status).toBe(200);

    const orders = await sql<{ customer_id: string | null }>`
      select customer_id from commerce.orders where id = ${orderId}
    `.execute(db);
    expect(orders.rows.length).toBe(1);
    expect(orders.rows[0]!.customer_id).toBeNull();
  });
});

afterAll(async () => {
  await h?.dispose();
});
