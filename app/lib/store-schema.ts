import { z } from "zod";
import { CURRENCIES, LOCALES } from "./ref-data";
import { m } from "@/paraglide/messages.js";

/** Percent with up to two decimals, 0–100. Stored as basis points (×100). */
const taxRate = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, { error: () => m.validation_tax_rate() })
  .refine((value) => Number(value) <= 100, { error: () => m.validation_tax_rate_max() });

export const storeSchema = z.object({
  name: z.string().trim().min(1, { error: () => m.validation_store_name() }),
  currencyCode: z.enum(CURRENCIES),
  locale: z.enum(LOCALES),
  taxLabel: z.string().trim().min(1, { error: () => m.validation_tax_label() }),
  taxRate,
  pricesIncludeTax: z.boolean(),
});

export type StoreFormValues = z.infer<typeof storeSchema>;
