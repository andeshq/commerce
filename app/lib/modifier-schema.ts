import { z } from "zod";

const optionalMoney = z
  .string()
  .trim()
  .refine((value) => value === "" || /^-?\d+(\.\d{1,2})?$/.test(value), {
    message: "Enter an amount like 2000 or -1500.",
  });

export const modifierValueSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Enter a name."),
  price: optionalMoney,
});

export const modifierSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name."),
    selectionType: z.enum(["single", "multiple"]),
    required: z.boolean(),
    values: z.array(modifierValueSchema).min(1, "Add at least one value."),
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
          message: "Duplicate value.",
        });
      } else {
        seen.add(key);
      }
    });
  });

export type ModifierValueDraft = z.infer<typeof modifierValueSchema>;
export type ModifierFormValues = z.infer<typeof modifierSchema>;
