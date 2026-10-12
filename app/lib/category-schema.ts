import { z } from "zod";
import { m } from "@/paraglide/messages.js";

/** `"none"` is the sentinel for "no parent" so list keys stay non-empty. */
export const NO_PARENT = "none";

export const categorySchema = z.object({
  name: z.string().trim().min(1, { error: () => m.validation_category_name() }),
  slug: z.string().trim().min(1, { error: () => m.validation_category_slug() }),
  parentId: z.string(),
  description: z.string(),
});

export type CategoryFormValues = z.infer<typeof categorySchema>;
