import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";
import { createHarness, type Harness } from "./helpers/harness.ts";
import { createMigrationDatabase } from "../src/database/migrator.ts";
import type { App } from "../src/lib/app.ts";

/**
 * Team management over Better Auth's admin plugin: admin-only access, create,
 * role changes, ban/unban, removal, self-protection, and the database lockout
 * guard that always keeps one active admin.
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

function makeClient(app: App) {
  return {
    post: async (path: string, body: unknown, cookie?: string) => {
      const res = await app.fetch(
        new Request(`http://localhost/api/auth/admin/${path}`, json(body, cookie)),
      );
      return { status: res.status, body: await parse(res) };
    },
    get: async (path: string, cookie?: string) => {
      const res = await app.fetch(
        new Request(`http://localhost/api/auth/admin/${path}`, {
          headers: cookie ? { cookie } : {},
        }),
      );
      return { status: res.status, body: await parse(res) };
    },
    signIn: async (email: string) => {
      const res = await app.fetch(
        new Request(
          "http://localhost/api/auth/sign-in/email",
          json({ email, password: PASSWORD }),
        ),
      );
      return { status: res.status, cookie: cookieFrom(res) };
    },
    signUp: async (email: string) => {
      await app.fetch(
        new Request(
          "http://localhost/api/auth/sign-up/email",
          json({ email, password: PASSWORD, name: email.split("@")[0] }),
        ),
      );
      return cookieFrom(
        await app.fetch(
          new Request(
            "http://localhost/api/auth/sign-in/email",
            json({ email, password: PASSWORD }),
          ),
        ),
      );
    },
    setup: async (email: string, storeName: string) => {
      await app.fetch(
        new Request(
          "http://localhost/api/setup",
          json({ email, password: PASSWORD, name: "Admin", storeName }),
        ),
      );
    },
  };
}

describe("team management", () => {
  let app: App;
  let db: ReturnType<typeof createMigrationDatabase>;
  let api: ReturnType<typeof makeClient>;
  let adminCookie: string;
  let adminId: string;

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
    api = makeClient(app);

    await api.setup("admin@andeshq.dev", "Team Store");
    adminCookie = (await api.signIn("admin@andeshq.dev")).cookie;
    adminId = await userId("admin@andeshq.dev");
  });

  test("anonymous cannot list users", async () => {
    expect((await api.get("list-users")).status).toBe(401);
  });

  test("customers cannot list users", async () => {
    const cookie = await api.signUp("customer@andeshq.dev");
    expect((await api.get("list-users", cookie)).status).toBe(403);
  });

  test("admin lists users", async () => {
    const { status, body } = await api.get("list-users", adminCookie);
    expect(status).toBe(200);
    expect(body.users.some((u: any) => u.email === "admin@andeshq.dev")).toBe(true);
  });

  test("admin creates a staff user who can sign in but not manage users", async () => {
    const created = await api.post(
      "create-user",
      { email: "staff@andeshq.dev", password: PASSWORD, name: "Staff", role: "staff" },
      adminCookie,
    );
    expect(created.status).toBe(200);
    expect(created.body.user.role).toBe("staff");

    const staffCookie = (await api.signIn("staff@andeshq.dev")).cookie;
    expect(staffCookie).not.toBe("");
    expect((await api.get("list-users", staffCookie)).status).toBe(403);
  });

  test("admin changes a role", async () => {
    const id = await userId("staff@andeshq.dev");

    const promoted = await api.post("set-role", { userId: id, role: "admin" }, adminCookie);
    expect(promoted.status).toBe(200);
    expect(promoted.body.user.role).toBe("admin");

    await api.post("set-role", { userId: id, role: "staff" }, adminCookie);

    const rows = await sql<{ role: string }>`
      select role from auth."user" where id = ${id}
    `.execute(db);
    expect(rows.rows[0]!.role).toBe("staff");
  });

  test("ban blocks sign-in until unbanned", async () => {
    const id = await userId("staff@andeshq.dev");

    const banned = await api.post("ban-user", { userId: id, banReason: "test" }, adminCookie);
    expect(banned.status).toBe(200);
    expect(banned.body.user.banned).toBe(true);

    expect((await api.signIn("staff@andeshq.dev")).status).toBeGreaterThanOrEqual(400);

    const unbanned = await api.post("unban-user", { userId: id }, adminCookie);
    expect(unbanned.status).toBe(200);
    expect((await api.signIn("staff@andeshq.dev")).cookie).not.toBe("");
  });

  test("admin updates a profile and resets a password", async () => {
    const id = await userId("staff@andeshq.dev");

    const updated = await api.post(
      "update-user",
      { userId: id, data: { name: "Staff Renamed" } },
      adminCookie,
    );
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe("Staff Renamed");

    const reset = await api.post(
      "set-user-password",
      { userId: id, newPassword: "newsecret123" },
      adminCookie,
    );
    expect(reset.status).toBe(200);

    expect((await api.signIn("staff@andeshq.dev")).status).toBeGreaterThanOrEqual(400);
    const next = await app.fetch(
      new Request(
        "http://localhost/api/auth/sign-in/email",
        json({ email: "staff@andeshq.dev", password: "newsecret123" }),
      ),
    );
    expect(next.status).toBe(200);
  });

  test("cannot ban or remove yourself", async () => {
    expect((await api.post("ban-user", { userId: adminId }, adminCookie)).status).toBe(400);
    expect((await api.post("remove-user", { userId: adminId }, adminCookie)).status).toBe(400);
  });

  test("admin removes a user", async () => {
    const created = await api.post(
      "create-user",
      { email: "temp@andeshq.dev", password: PASSWORD, name: "Temp", role: "staff" },
      adminCookie,
    );
    const id = created.body.user.id;

    expect((await api.post("remove-user", { userId: id }, adminCookie)).status).toBe(200);

    const rows = await sql<{ count: string }>`
      select count(*)::text as count from auth."user" where id = ${id}
    `.execute(db);
    expect(rows.rows[0]!.count).toBe("0");
  });
});

describe("last-admin lockout guard", () => {
  let app: App;
  let db: ReturnType<typeof createMigrationDatabase>;
  let api: ReturnType<typeof makeClient>;
  let adminCookie: string;
  let adminId: string;

  beforeAll(async () => {
    const databaseUrl = await h!.createDatabase();
    app = await h!.app(databaseUrl);
    db = createMigrationDatabase(databaseUrl);
    api = makeClient(app);

    await api.setup("solo@andeshq.dev", "Solo Store");
    adminCookie = (await api.signIn("solo@andeshq.dev")).cookie;

    const rows = await sql<{ id: string }>`
      select id from auth."user" where email = 'solo@andeshq.dev'
    `.execute(db);
    adminId = rows.rows[0]!.id;
  });

  test("the only admin cannot be demoted through the API", async () => {
    const res = await api.post("set-role", { userId: adminId, role: "staff" }, adminCookie);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("the trigger rejects demoting or deleting the last admin directly", async () => {
    await expect(
      sql`update auth."user" set role = 'staff' where id = ${adminId}`.execute(db),
    ).rejects.toThrow(/last admin/);

    await expect(
      sql`delete from auth."user" where id = ${adminId}`.execute(db),
    ).rejects.toThrow(/last admin/);
  });

  test("demotion is allowed once a second admin exists", async () => {
    await api.post(
      "create-user",
      { email: "second@andeshq.dev", password: PASSWORD, name: "Second", role: "admin" },
      adminCookie,
    );

    await sql`update auth."user" set role = 'staff' where id = ${adminId}`.execute(db);

    const rows = await sql<{ role: string }>`
      select role from auth."user" where id = ${adminId}
    `.execute(db);
    expect(rows.rows[0]!.role).toBe("staff");
  });

  afterAll(async () => {
    await db.destroy();
  });
});

afterAll(async () => {
  await h?.dispose();
});
