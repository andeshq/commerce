import { z } from "zod";
import { m } from "@/paraglide/messages.js";

/** Name + value rows, shared by the option create and update pages. */
export const optionSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { error: () => m.validation_option_name() }),
    values: z
      .array(
        z.object({
          id: z.string().optional(),
          /** How many variants use this value; present for saved rows. */
          usage: z.number().optional(),
          value: z
            .string()
            .trim()
            .min(1, { error: () => m.validation_option_value() }),
        }),
      )
      .min(1, { error: () => m.validation_option_min_values() }),
  })
  .superRefine((option, ctx) => {
    const seen = new Set<string>();
    option.values.forEach((row, index) => {
      const key = row.value.trim().toLowerCase();
      if (!key) return;
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["values", index, "value"],
          message: m.validation_duplicate_value(),
        });
      } else {
        seen.add(key);
      }
    });
  });

export type OptionFormValues = z.infer<typeof optionSchema>;
