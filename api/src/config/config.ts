import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { singleton } from "tsyringe";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  PORT: z.coerce.number().int().positive().default(3000),
  BASE_URL: z.string().url().default("http://localhost:5173"),
});

export type Env = z.infer<typeof envSchema>;

const DEFAULTS = {
  domainSchema: "commerce",
  authSchema: "auth",
  basePath: "/rest",
  anonRole: "web_anon",
  maxRows: 1000,
} as const;

/** Currency, locale and tax are decided at first-run setup, not env. */
export const SETUP_ROLES = ["web_anon", "web_customer", "web_staff", "web_admin"] as const;

/** Unpaid orders are cancelled and restocked after this window. */
export const ORDER_EXPIRY_MINUTES = 30;

/** How often the maintenance sweep runs (safe to run on every replica). */
export const MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * The built admin UI (`app/dist`). In production the API serves it directly, so
 * the app and API share an origin; in development Vite serves it instead.
 */
export const STATIC_DIR = fileURLToPath(new URL("../../../app/dist", import.meta.url));

/**
 * Relations pgbase may serve. Default-deny: a new table is not reachable until
 * it is added here, so a migration cannot accidentally publish a table.
 * Row access is still governed by RLS; this only controls reachability.
 */
export const EXPOSED_TABLES = [
  "store_settings",
  "products",
  "product_variants",
  "product_variant_costs",
  "options",
  "option_values",
  "product_options",
  "modifier_groups",
  "modifier_values",
  "product_modifier_groups",
  "categories",
  "media",
  "product_media",
  "variant_media",
  "variant_option_values",
  "inventory_locations",
  "inventory_levels",
  "inventory_movements",
  "orders",
  "order_items",
  "order_events",
  "payments",
] as const;

export const EXPOSED_VIEWS: readonly string[] = [
  "catalog_variants",
  "storefront_products",
  "storefront_categories",
];

@singleton()
export class Config {
  readonly databaseUrl: string;
  readonly authSecret: string;
  readonly port: number;
  readonly baseUrl: string;

  readonly nodeEnv: NodeJS.ProcessEnv["NODE_ENV"];
  readonly isProduction: boolean;

  readonly domainSchema = DEFAULTS.domainSchema;
  readonly authSchema = DEFAULTS.authSchema;
  readonly basePath = DEFAULTS.basePath;
  readonly anonRole = DEFAULTS.anonRole;
  readonly maxRows = DEFAULTS.maxRows;
  readonly exposedTables: readonly string[] = EXPOSED_TABLES;
  readonly exposedViews: readonly string[] = EXPOSED_VIEWS;

  /** Built admin UI directory (served in production). */
  readonly staticDir: string;
  readonly serveStatic: boolean;

  /** True only in development; surfaces verbose errors. */
  readonly debug: boolean;

  constructor() {
    const parsed = envSchema.safeParse(process.env);

    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("\n");
      throw new Error(`Invalid environment configuration:\n${issues}`);
    }

    const value = parsed.data;

    this.databaseUrl = value.DATABASE_URL;
    this.authSecret = value.AUTH_SECRET;
    this.port = value.PORT;
    this.baseUrl = value.BASE_URL;

    this.nodeEnv = process.env.NODE_ENV;
    this.isProduction = this.nodeEnv === "production";
    this.debug = !this.isProduction;

    this.staticDir = STATIC_DIR;
    this.serveStatic = this.isProduction && existsSync(STATIC_DIR);
  }
}
