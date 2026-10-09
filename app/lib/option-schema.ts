import { z } from "zod";

/** Name + value rows, shared by the option create and update pages. */
export const optionSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name."),
    values: z
      .array(
        z.object({
          id: z.string().optional(),
          /** How many variants use this value; present for saved rows. */
          usage: z.number().optional(),
          value: z.string().trim().min(1, "Enter a value."),
        }),
      )
      .min(1, "Add at least one value."),
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
          message: "Duplicate value.",
        });
      } else {
        seen.add(key);
      }
    });
  });

export type OptionFormValues = z.infer<typeof optionSchema>;
