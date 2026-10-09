import { cents, toCents, type OptionWithValues, type VariantWithLinks } from "./catalog";
import { NO_CATEGORY, type ProductFields, type VariantDraft } from "./product-schema";

export type { ProductFields, VariantDraft };

export interface Removal {
  table:
    | "product_variants"
    | "product_options"
    | "product_modifier_groups"
    | "variant_option_values";
  /** Equality filters; composite keys pass more than one pair. */
  filters: Array<[column: string, value: string]>;
}

export const MAX_VARIANTS = 250;

/** How many variant rows the selected options expand to. */
export function combinationCount(options: OptionWithValues[]): number {
  return options.reduce(
    (total, option) => total * Math.max(option.option_values.length, 1),
    1,
  );
}

export function emptyVariant(title: string): VariantDraft {
  return {
    title,
    sku: "",
    barcode: "",
    price: "",
    compareAt: "",
    weightGrams: "",
    requiresShipping: true,
    taxable: true,
    taxRate: "",
    cost: "",
    optionValueIds: [],
  };
}

export function draftFromVariant(variant: VariantWithLinks): VariantDraft {
  const money = (value: string | number | null) =>
    value === null || value === undefined ? "" : String(cents(value) / 100);

  return {
    id: variant.id,
    title: variant.title,
    sku: variant.sku ?? "",
    barcode: variant.barcode ?? "",
    price: money(variant.price_cents),
    compareAt: money(variant.compare_at_price_cents),
    weightGrams: variant.weight_grams === null ? "" : String(variant.weight_grams),
    requiresShipping: variant.requires_shipping,
    taxable: variant.taxable,
    taxRate:
      variant.tax_rate_bps === null || variant.tax_rate_bps === undefined
        ? ""
        : String(variant.tax_rate_bps / 100),
    cost: money(variant.product_variant_costs?.cost_cents ?? null),
    optionValueIds: variant.variant_option_values.map((link) => link.option_value_id),
  };
}

/** Cartesian of the selected options' values, in option/value position order. */
export function variantMatrix(
  options: OptionWithValues[],
): Array<{ title: string; optionValueIds: string[] }> {
  if (options.length === 0) return [{ title: "Default", optionValueIds: [] }];

  let combos: Array<{ values: string[]; ids: string[] }> = [{ values: [], ids: [] }];
  for (const option of options) {
    const values = [...option.option_values].sort((a, b) => a.position - b.position);
    const next: typeof combos = [];
    for (const combo of combos) {
      for (const value of values) {
        next.push({
          values: [...combo.values, value.value],
          ids: [...combo.ids, value.id],
        });
      }
    }
    combos = next;
  }

  return combos.map((combo) => ({
    title: combo.values.join(" / "),
    optionValueIds: combo.ids,
  }));
}

/**
 * Regenerate rows for the selected options, keeping the edits of variants whose
 * option-value set still exists (matched by set, not by order).
 */
export function syncVariants(
  drafts: VariantDraft[],
  options: OptionWithValues[],
): VariantDraft[] {
  const key = (ids: string[]) => [...ids].sort().join("|");
  const existing = new Map(drafts.map((draft) => [key(draft.optionValueIds), draft]));

  return variantMatrix(options).map(({ title, optionValueIds }) => {
    const match = existing.get(key(optionValueIds));
    return match ? { ...match, title, optionValueIds } : { ...emptyVariant(title), optionValueIds };
  });
}

function variantFields(draft: VariantDraft) {
  return {
    title: draft.title.trim() || "Default",
    sku: draft.sku.trim() || null,
    barcode: draft.barcode.trim() || null,
    price_cents: toCents(draft.price) ?? 0,
    compare_at_price_cents: toCents(draft.compareAt),
    weight_grams: draft.weightGrams.trim() ? Number(draft.weightGrams) : null,
    requires_shipping: draft.requiresShipping,
    taxable: draft.taxable,
    tax_rate_bps: draft.taxRate.trim() ? Math.round(Number(draft.taxRate) * 100) : null,
  };
}

function costField(draft: VariantDraft) {
  const cost = toCents(draft.cost);
  return cost === null ? {} : { product_variant_costs: { cost_cents: cost } };
}

/**
 * Nested-write shapes differ between insert and update:
 *  - POST inserts related rows, so junction links are written directly
 *    (`product_options`, `variant_option_values`).
 *  - PATCH treats an element with its PK as an update and one without as an
 *    insert, and many-to-many links are ensured through the related table
 *    (`options`, `option_values`).
 *  - A new variant inside a PATCH is an insert, so it uses the junction shape.
 * Neither path deletes: removals are separate DELETE requests.
 */
export function buildCreatePayload(
  fields: ProductFields,
  selectedOptionIds: string[],
  modifierGroupIds: string[],
  mediaIds: string[],
  drafts: VariantDraft[],
) {
  return {
    id: crypto.randomUUID(),
    title: fields.title,
    slug: fields.slug,
    status: fields.status,
    vendor: fields.vendor || null,
    product_type: fields.productType.trim() || null,
    category_id: fields.categoryId === NO_CATEGORY ? null : fields.categoryId,
    description: fields.description || null,
    product_options: selectedOptionIds.map((option_id, position) => ({ option_id, position })),
    product_modifier_groups: modifierGroupIds.map((group_id, position) => ({
      group_id,
      position,
    })),
    product_media: mediaIds.map((media_id, position) => ({ media_id, position })),
    product_variants: drafts.map((draft, position) => ({
      id: draft.id ?? crypto.randomUUID(),
      ...variantFields(draft),
      position,
      variant_option_values: draft.optionValueIds.map((option_value_id) => ({ option_value_id })),
      ...costField(draft),
    })),
  };
}

export function buildUpdatePayload(
  fields: ProductFields,
  selectedOptionIds: string[],
  modifierGroupIds: string[],
  drafts: VariantDraft[],
) {
  return {
    title: fields.title,
    slug: fields.slug,
    status: fields.status,
    vendor: fields.vendor || null,
    product_type: fields.productType.trim() || null,
    category_id: fields.categoryId === NO_CATEGORY ? null : fields.categoryId,
    description: fields.description || null,
    options: selectedOptionIds.map((id) => ({ id })),
    modifier_groups: modifierGroupIds.map((id) => ({ id })),
    product_variants: drafts.map((draft, position) =>
      draft.id
        ? {
            id: draft.id,
            ...variantFields(draft),
            position,
            option_values: draft.optionValueIds.map((id) => ({ id })),
            ...(costField(draft).product_variant_costs
              ? {
                  product_variant_costs: {
                    variant_id: draft.id,
                    ...costField(draft).product_variant_costs,
                  },
                }
              : {}),
          }
        : {
            ...variantFields(draft),
            position,
            variant_option_values: draft.optionValueIds.map((option_value_id) => ({
              option_value_id,
            })),
            ...costField(draft),
          },
    ),
  };
}

/** What the payload cannot express: rows present before but missing now. */
export function computeRemovals(
  productId: string,
  loaded: {
    variants: VariantWithLinks[];
    optionIds: string[];
    modifierIds: string[];
  },
  selectedOptionIds: string[],
  modifierGroupIds: string[],
  drafts: VariantDraft[],
): Removal[] {
  const removals: Removal[] = [];

  const keptVariantIds = new Set(drafts.map((draft) => draft.id).filter(Boolean) as string[]);
  for (const variant of loaded.variants) {
    if (!keptVariantIds.has(variant.id)) {
      removals.push({ table: "product_variants", filters: [["id", variant.id]] });
      continue;
    }

    const draft = drafts.find((row) => row.id === variant.id);
    const keptValues = new Set(draft?.optionValueIds ?? []);
    for (const link of variant.variant_option_values) {
      if (!keptValues.has(link.option_value_id)) {
        removals.push({
          table: "variant_option_values",
          filters: [
            ["variant_id", variant.id],
            ["option_value_id", link.option_value_id],
          ],
        });
      }
    }
  }

  const keptOptionIds = new Set(selectedOptionIds);
  for (const optionId of loaded.optionIds) {
    if (!keptOptionIds.has(optionId)) {
      removals.push({
        table: "product_options",
        filters: [
          ["product_id", productId],
          ["option_id", optionId],
        ],
      });
    }
  }

  const keptModifierIds = new Set(modifierGroupIds);
  for (const groupId of loaded.modifierIds) {
    if (!keptModifierIds.has(groupId)) {
      removals.push({
        table: "product_modifier_groups",
        filters: [
          ["product_id", productId],
          ["group_id", groupId],
        ],
      });
    }
  }

  return removals;
}
