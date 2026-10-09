import { sql, type Kysely } from "kysely";

/**
 * The money-cast read model: variants with their product identity where money
 * travels as text, so JSON responses never carry bigint-as-number surprises
 * (Postgres renders embedded bigints as JSON numbers; `JSON.stringify` on
 * BigInt throws). `security_invoker` keeps RLS in charge of visibility: anon
 * sees active products, staff sees everything.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    create view commerce.catalog_variants
    with (security_invoker = true)
    as
    select
      v.id,
      v.product_id,
      v.title,
      v.sku,
      v.barcode,
      v.position,
      v.price_cents::text as price_cents,
      v.compare_at_price_cents::text as compare_at_price_cents,
      v.weight_grams,
      v.requires_shipping,
      v.taxable,
      p.title as product_title,
      p.slug as product_slug,
      p.status as product_status,
      p.vendor,
      p.category_id
    from commerce.product_variants v
    join commerce.products p on p.id = v.product_id;

    grant select on commerce.catalog_variants to web_anon, web_customer, web_staff, web_admin;
  `).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`drop view if exists commerce.catalog_variants;`).execute(db);
}
