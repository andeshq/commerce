import { z } from "zod";
import { CURRENCIES, LOCALES } from "./ref-data";

/** Percent with up to two decimals, 0–100. Stored as basis points (×100). */
const taxRate = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter a rate like 19 or 7.5.")
  .refine((value) => Number(value) <= 100, "The rate cannot exceed 100%.");

export const storeSchema = z.object({
  name: z.string().trim().min(1, "Enter a store name."),
  currencyCode: z.enum(CURRENCIES),
  locale: z.enum(LOCALES),
  taxLabel: z.string().trim().min(1, "Enter a tax label."),
  taxRate,
  pricesIncludeTax: z.boolean(),
});

export type StoreFormValues = z.infer<typeof storeSchema>;
