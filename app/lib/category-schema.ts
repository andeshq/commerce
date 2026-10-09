import { z } from "zod";

/** `"none"` is the sentinel for "no parent" so list keys stay non-empty. */
export const NO_PARENT = "none";

export const categorySchema = z.object({
  name: z.string().trim().min(1, "Enter a name."),
  slug: z.string().trim().min(1, "Enter a slug."),
  parentId: z.string(),
  description: z.string(),
});

export type CategoryFormValues = z.infer<typeof categorySchema>;
