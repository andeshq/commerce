import { z } from "zod";
import { PRODUCT_STATUSES } from "./catalog";

const optionalMoney = z
  .string()
  .trim()
  .refine((value) => value === "" || /^\d+(\.\d{1,2})?$/.test(value), {
    message: "Enter an amount like 120000 or 120000.50.",
  });

const optionalWholeNumber = z
  .string()
  .trim()
  .refine((value) => value === "" || /^\d+$/.test(value), {
    message: "Use whole numbers.",
  });

/** Percent override; empty means "use the store rate". */
const optionalPercent = z
  .string()
  .trim()
  .refine((value) => value === "" || /^\d{1,3}(\.\d{1,2})?$/.test(value), {
    message: "Enter a rate like 19 or 7.5.",
  })
  .refine((value) => value === "" || Number(value) <= 100, {
    message: "The rate cannot exceed 100%.",
  });

export const variantDraftSchema = z.object({
  /** Set only for rows that already exist in the database. */
  id: z.string().optional(),
  title: z.string(),
  sku: z.string(),
  barcode: z.string(),
  price: optionalMoney,
  compareAt: optionalMoney,
  weightGrams: optionalWholeNumber,
  requiresShipping: z.boolean(),
  taxable: z.boolean(),
  taxRate: optionalPercent,
  cost: optionalMoney,
  optionValueIds: z.array(z.string()),
});

/** Sentinel for "no category" so list keys stay non-empty. */
export const NO_CATEGORY = "none";

export const productFormSchema = z.object({
  title: z.string().trim().min(1, "Enter a title."),
  slug: z.string().trim().min(1, "Enter a slug."),
  status: z.enum(PRODUCT_STATUSES),
  vendor: z.string(),
  productType: z.string(),
  categoryId: z.string(),
  description: z.string(),
  optionIds: z.array(z.string()),
  modifierGroupIds: z.array(z.string()),
  variants: z.array(variantDraftSchema).min(1, "Keep at least one variant."),
});

export type VariantDraft = z.infer<typeof variantDraftSchema>;
export type ProductFormValues = z.infer<typeof productFormSchema>;
export type ProductFields = Pick<
  ProductFormValues,
  "title" | "slug" | "status" | "vendor" | "productType" | "categoryId" | "description"
>;
