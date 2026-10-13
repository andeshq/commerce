import { z } from "zod";
import { m } from "@/paraglide/messages.js";

export const collectionSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: () => m.collections_name() }),
  slug: z
    .string()
    .trim()
    .min(1, { error: () => m.collections_slug() }),
  description: z.string(),
});

export type CollectionFormValues = z.infer<typeof collectionSchema>;
