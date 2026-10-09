import { singleton } from "tsyringe";
import { sql } from "kysely";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { Database } from "../database/database.ts";
import { Auth } from "../lib/auth.ts";

const LOCALES = ["es-CO", "en-US"] as const;

export const setupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  storeName: z.string().min(1),
  /** Mirrors the app's enums; the DB only enforces the code format. */
  currencyCode: z.enum(["COP", "USD"]).default("COP"),
  locale: z.enum(LOCALES).default("es-CO"),
  pricesIncludeTax: z.boolean().default(true),
});

export type SetupInput = z.infer<typeof setupSchema>;

/** The store's first location, named in the language chosen at setup. */
export function defaultLocationName(locale: (typeof LOCALES)[number]): string {
  return locale === "en-US" ? "Main location" : "Tienda principal";
}

/** Sensible first-run tax: IVA 19% for Colombia, none otherwise. */
export function defaultTax(locale: (typeof LOCALES)[number]): { rateBps: number; label: string } {
  return locale === "es-CO" ? { rateBps: 1900, label: "IVA" } : { rateBps: 0, label: "Tax" };
}

function isDuplicateAccountError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const body = (error as { body?: { code?: unknown } }).body;
  return body?.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL";
}

@singleton()
export class SetupService {
  constructor(
    private readonly database: Database,
    private readonly auth: Auth,
  ) {}

  /**
   * True while no admin exists. This is the bootstrap lock: the setup routes
   * stop responding the moment the first admin is created.
   *
   * The admin plugin's `listUsers` requires an admin session, so it cannot be
   * used to bootstrap. Query the auth table directly instead.
   */
  async needsSetup(): Promise<boolean> {
    const result = await sql<{ count: string }>`
      select count(*)::text as count
      from auth."user"
      where role = 'admin'
    `.execute(this.database);

    return Number(result.rows[0]?.count ?? "0") === 0;
  }

  async run(input: SetupInput) {
    if (!(await this.needsSetup())) {
      throw new HTTPException(409, { message: "Already set up" });
    }

    // The singleton PK (id = true) is the race gate. Insert it first: a second
    // concurrent setup fails here before any admin is created. The store's
    // first location rides along, so stock is adjustable from day one.
    try {
      const tax = defaultTax(input.locale);
      await this.database.transaction().execute(async (trx) => {
        await trx
          .withSchema("commerce")
          .insertInto("store_settings")
          .values({
            id: true,
            name: input.storeName,
            currency_code: input.currencyCode,
            locale: input.locale,
            prices_include_tax: input.pricesIncludeTax,
            tax_rate_bps: tax.rateBps,
            tax_label: tax.label,
          })
          .execute();

        await trx
          .withSchema("commerce")
          .insertInto("inventory_locations")
          .values({ name: defaultLocationName(input.locale), code: "MAIN", is_default: true })
          .execute();
      });
    } catch {
      throw new HTTPException(409, { message: "Already set up" });
    }

    // Create the first admin. Better Auth uses its own connection, so this is
    // not part of a shared transaction — compensate by removing the store row
    // if it fails, leaving the instance un-configured and retryable.
    try {
      const user = await this.auth.createUser({
        email: input.email,
        password: input.password,
        name: input.name,
        role: "admin",
      });

      return {
        user,
        store: {
          name: input.storeName,
          currencyCode: input.currencyCode,
          locale: input.locale,
          pricesIncludeTax: input.pricesIncludeTax,
        },
      };
    } catch (error) {
      await this.database
        .withSchema("commerce")
        .deleteFrom("inventory_locations")
        .where("code", "=", "MAIN")
        .execute()
        .catch(() => undefined);
      await this.database
        .withSchema("commerce")
        .deleteFrom("store_settings")
        .where("id", "=", true)
        .execute()
        .catch(() => undefined);
      if (isDuplicateAccountError(error)) {
        throw new HTTPException(409, { message: "An account with this email already exists" });
      }
      throw error;
    }
  }
}
