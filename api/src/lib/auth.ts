import { singleton } from "tsyringe";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { HTTPException } from "hono/http-exception";
import { Config } from "../config/config.ts";
import { Database } from "../database/database.ts";

export type AppRole = "admin" | "staff" | "customer";

export interface AuthSession {
  user: { id: string; email: string; name: string; role?: string | null };
}

@singleton()
export class Auth {
  // Options are inlined so better-auth infers the admin plugin's API
  // (`createUser`, `listUsers`, ...) onto `instance.api`.
  readonly instance: ReturnType<typeof createAuth>;

  constructor(config: Config, database: Database) {
    this.instance = createAuth(config, database);
  }

  handle(request: Request): Promise<Response> {
    return this.instance.handler(request);
  }

  async getSession(headers: Headers): Promise<AuthSession | null> {
    const session = await this.instance.api.getSession({ headers });
    return (session as AuthSession | null) ?? null;
  }

  /** Guard for staff-only endpoints. */
  async requireStaff(headers: Headers): Promise<AuthSession> {
    const session = await this.getSession(headers);
    if (!session) throw new HTTPException(401, { message: "Sign in required." });
    if (!["admin", "staff"].includes(session.user.role ?? "")) {
      throw new HTTPException(403, { message: "Staff access required." });
    }
    return session;
  }

  /** Guard for admin-only endpoints (payment provider credentials). */
  async requireAdmin(headers: Headers): Promise<AuthSession> {
    const session = await this.requireStaff(headers);
    if (session.user.role !== "admin") {
      throw new HTTPException(403, { message: "Admin access required." });
    }
    return session;
  }

  /**
   * Create a user through Better Auth's internal path: password hashing and
   * credential-account linking happen correctly. Without request headers the
   * admin plugin skips its permission check, which is what bootstrap needs.
   */
  async createUser(input: {
    email: string;
    password: string;
    name: string;
    role: "admin";
  }): Promise<{ id: string; email: string; name: string }> {
    const { user } = await this.instance.api.createUser({
      body: {
        email: input.email,
        password: input.password,
        name: input.name,
        role: input.role,
      },
    });
    return { id: user.id, email: user.email, name: user.name };
  }
}

function createAuth(config: Config, database: Database) {
  return betterAuth({
    database: {
      db: database,
      type: "postgres",
      schemaName: config.authSchema,
    },
    baseURL: config.baseUrl,
    secret: config.authSecret,
    emailAndPassword: { enabled: true },
    plugins: [admin({ defaultRole: "customer", adminRoles: ["admin"] })],
  });
}
