import { singleton } from "tsyringe";
import { createPgbase, PgbaseError, type Pgbase as PgbaseInstance } from "pgbase";
import { Config } from "../config/config.ts";
import { Database } from "../database/database.ts";
import type { DatabaseSchema } from "../database/types.ts";
import { Auth } from "./auth.ts";

export type PgRole = "web_anon" | "web_customer" | "web_staff" | "web_admin";

const APP_TO_PG: Record<string, PgRole> = {
  customer: "web_customer",
  staff: "web_staff",
  admin: "web_admin",
};

/**
 * Map an app role (Better Auth `user.role`) to the Postgres role pgbase
 * impersonates. Unknown, absent or malicious values fall back to the anon role
 * — never to the connection role, which would be a privilege escalation.
 */
export function mapAppRoleToPgRole(
  appRole: string | null | undefined,
  anonRole: string,
): string {
  return (appRole && APP_TO_PG[appRole]) || anonRole;
}

@singleton()
export class Pgbase {
  readonly instance: PgbaseInstance<DatabaseSchema>;

  constructor(config: Config, database: Database, auth: Auth) {
    this.instance = createPgbase<DatabaseSchema>({
      database,
      schemaName: config.domainSchema,
      extraSearchPath: [config.domainSchema],
      basePath: config.basePath,
      maxRows: config.maxRows,
      anonRole: config.anonRole,
      exposed: {
        tables: [...config.exposedTables],
        views: [...config.exposedViews],
      },
      errorVerbosity: config.isProduction ? "minimal" : "verbose",
      debug: config.debug,

      getSession: async (request) => {
        const session = await auth.getSession(request.headers);
        if (!session) return null;

        const role = mapAppRoleToPgRole(session.user.role, config.anonRole);
        return { role, sub: session.user.id, email: session.user.email };
      },

      onError: (error) => {
        if (error instanceof PgbaseError && error.status >= 500) {
          console.error("[pgbase]", error);
        }
      },
    });
  }

  handler(request: Request): Promise<Response> {
    return this.instance.handler(request);
  }
}
