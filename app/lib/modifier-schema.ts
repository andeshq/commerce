import { z } from "zod";
import { m } from "@/paraglide/messages.js";

const optionalMoney = z
  .string()
  .trim()
  .refine((value) => value === "" || /^-?\d+(\.\d{1,2})?$/.test(value), {
    error: () => m.validation_modifier_money(),
  });

export const modifierValueSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, { error: () => m.validation_option_name() }),
  price: optionalMoney,
});

export const modifierSchema = z
  .object({
    name: z.string().trim().min(1, { error: () => m.validation_option_name() }),
    selectionType: z.enum(["single", "multiple"]),
    required: z.boolean(),
    values: z.array(modifierValueSchema).min(1, { error: () => m.validation_modifier_min_values() }),
  })
  .superRefine((modifier, ctx) => {
    const seen = new Set<string>();
    modifier.values.forEach((row, index) => {
      const key = row.name.trim().toLowerCase();
      if (!key) return;
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["values", index, "name"],
          message: m.validation_duplicate_value(),
        });
      } else {
        seen.add(key);
      }
    });
  });

export type ModifierValueDraft = z.infer<typeof modifierValueSchema>;
export type ModifierFormValues = z.infer<typeof modifierSchema>;
