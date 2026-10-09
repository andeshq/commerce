import { cents } from "./catalog";
import { pgbase } from "./pgbase";
import type { Product, VariantWithLinks } from "./catalog";

/**
 * Copies a product graph — variants, option values, costs, images, links and
 * variant images — as a draft, returning the new product id. Stock and orders
 * stay behind: this is a catalog copy, not a clone of state.
 */
export async function duplicateProduct(productId: string): Promise<string> {
  const [product, variants, links, modifierLinks, productMedia, variantMedia] = await Promise.all([
    pgbase.from("products").select("*").eq("id", productId).single().throwOnError(),
    pgbase
      .from("catalog_variants")
      .select("*,variant_option_values(option_value_id),product_variant_costs(cost_cents)")
      .eq("product_id", productId)
      .order("position", { ascending: true })
      .throwOnError(),
    pgbase.from("product_options").select("option_id,position").eq("product_id", productId).throwOnError(),
    pgbase
      .from("product_modifier_groups")
      .select("group_id,position")
      .eq("product_id", productId)
      .throwOnError(),
    pgbase.from("product_media").select("media_id,position").eq("product_id", productId).throwOnError(),
    pgbase.from("variant_media").select("variant_id,media_id").throwOnError(),
  ]);

  const source = product.data as Product;
  const sourceVariants = variants.data as VariantWithLinks[];
  const sourceLinks = links.data as Array<{ option_id: string; position: number }>;
  const sourceModifierLinks = modifierLinks.data as Array<{ group_id: string; position: number }>;
  const sourceMedia = productMedia.data as Array<{ media_id: string; position: number }>;
  const sourceVariantMedia = new Map(
    (variantMedia.data as Array<{ variant_id: string; media_id: string }>).map((link) => [
      link.variant_id,
      link.media_id,
    ]),
  );

  const slugBase = `${source.slug}-copy`;
  const proposedSkus = sourceVariants
    .map((variant) => variant.sku)
    .filter((sku): sku is string => Boolean(sku));

  const [slugRows, skuRows] = await Promise.all([
    pgbase.from("products").select("slug").like("slug", `${slugBase}%`).throwOnError(),
    proposedSkus.length > 0
      ? pgbase.from("product_variants").select("sku").in("sku", proposedSkus).throwOnError()
      : Promise.resolve({ data: [] as Array<{ sku: string }> }),
  ]);

  const takenSlugs = new Set(
    ((slugRows.data ?? []) as Array<{ slug: string }>).map((row) => row.slug),
  );
  let slug = slugBase;
  for (let n = 2; takenSlugs.has(slug) && n < 100; n++) slug = `${slugBase}-${n}`;

  // SKUs are unique per store, so copies get -2, -3, … suffixes.
  const takenSkus = new Set(
    ((skuRows.data ?? []) as Array<{ sku: string }>).map((row) => row.sku),
  );
  const uniqueSku = (base: string): string => {
    if (!takenSkus.has(base)) {
      takenSkus.add(base);
      return base;
    }
    for (let n = 2; n < 100; n++) {
      const candidate = `${base}-${n}`;
      if (!takenSkus.has(candidate)) {
        takenSkus.add(candidate);
        return candidate;
      }
    }
    return base;
  };

  const payload = {
    id: crypto.randomUUID(),
    title: `${source.title} (copy)`,
    slug,
    status: "draft" as const,
    vendor: source.vendor,
    product_type: source.product_type,
    category_id: source.category_id,
    description: source.description,
    product_options: sourceLinks.map((link) => ({
      option_id: link.option_id,
      position: link.position,
    })),
    product_modifier_groups: sourceModifierLinks.map((link) => ({
      group_id: link.group_id,
      position: link.position,
    })),
    product_media: sourceMedia.map((link) => ({
      media_id: link.media_id,
      position: link.position,
    })),
    product_variants: sourceVariants.map((variant, position) => ({
      id: crypto.randomUUID(),
      title: variant.title,
      sku: variant.sku ? uniqueSku(variant.sku) : null,
      barcode: variant.barcode,
      price_cents: cents(variant.price_cents),
      compare_at_price_cents:
        variant.compare_at_price_cents === null
          ? null
          : cents(variant.compare_at_price_cents),
      weight_grams: variant.weight_grams,
      requires_shipping: variant.requires_shipping,
      taxable: variant.taxable,
      position,
      variant_option_values: variant.variant_option_values.map((link) => ({
        option_value_id: link.option_value_id,
      })),
      ...(variant.product_variant_costs
        ? {
            product_variant_costs: {
              cost_cents: cents(variant.product_variant_costs.cost_cents),
            },
          }
        : {}),
      ...(sourceVariantMedia.get(variant.id)
        ? { variant_media: [{ media_id: sourceVariantMedia.get(variant.id) }] }
        : {}),
    })),
  };

  await pgbase.from("products").insert(payload).throwOnError();
  return payload.id;
}
