import type { Migration, MigrationProvider } from "kysely/migration";

import * as m01 from "./20260101000001_init.ts";
import * as m02 from "./20260101000002_auth.ts";
import * as m03 from "./20260101000003_catalog.ts";
import * as m04 from "./20260101000004_rls.ts";
import * as m05 from "./20260101000005_variant_costs.ts";
import * as m06 from "./20260101000006_options.ts";
import * as m07 from "./20260101000007_modifiers.ts";
import * as m08 from "./20260101000008_inventory_rpc.ts";
import * as m09 from "./20260101000009_catalog_variants_view.ts";
import * as m10 from "./20260101000010_store_code_formats.ts";
import * as m11 from "./20260101000011_inventory_locations_hardening.ts";
import * as m12 from "./20260101000012_checkout_foundations.ts";
import * as m13 from "./20260101000013_orders.ts";
import * as m14 from "./20260101000014_carts.ts";
import * as m15 from "./20260101000015_cart_rpc.ts";
import * as m16 from "./20260101000016_checkout_rpc.ts";
import * as m17 from "./20260101000017_order_actions.ts";
import * as m18 from "./20260101000018_tax.ts";
import * as m19 from "./20260101000019_storefront_api.ts";
import * as m20 from "./20260101000020_wompi_provider.ts";
import * as m21 from "./20260101000021_order_lifecycle.ts";
import * as m22 from "./20260101000022_multi_provider.ts";

/**
 * Migrations are imported statically so `bun build --compile` can bundle them:
 * the file-based provider reads from disk at runtime, which does not exist
 * inside a compiled executable. Add a migration by importing it and adding its
 * entry below; the key must match the file name — it is the identity stored in
 * `kysely_migration` and must never change.
 */
export const migrations: Record<string, Migration> = {
  "20260101000001_init": m01,
  "20260101000002_auth": m02,
  "20260101000003_catalog": m03,
  "20260101000004_rls": m04,
  "20260101000005_variant_costs": m05,
  "20260101000006_options": m06,
  "20260101000007_modifiers": m07,
  "20260101000008_inventory_rpc": m08,
  "20260101000009_catalog_variants_view": m09,
  "20260101000010_store_code_formats": m10,
  "20260101000011_inventory_locations_hardening": m11,
  "20260101000012_checkout_foundations": m12,
  "20260101000013_orders": m13,
  "20260101000014_carts": m14,
  "20260101000015_cart_rpc": m15,
  "20260101000016_checkout_rpc": m16,
  "20260101000017_order_actions": m17,
  "20260101000018_tax": m18,
  "20260101000019_storefront_api": m19,
  "20260101000020_wompi_provider": m20,
  "20260101000021_order_lifecycle": m21,
  "20260101000022_multi_provider": m22,
};

/** Kysely provider over the statically imported migrations. */
export class StaticMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return migrations;
  }
}
