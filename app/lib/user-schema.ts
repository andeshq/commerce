import { z } from "zod";
import { TEAM_ROLES } from "./users";

export const userCreateSchema = z.object({
  name: z.string().trim().min(1, "Enter a name."),
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
  role: z.enum(TEAM_ROLES),
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(1, "Enter a name."),
  email: z.email("Enter a valid email address."),
  role: z.enum(TEAM_ROLES),
  /** Blank keeps the current password; otherwise it must be a valid new one. */
  password: z
    .string()
    .refine((value) => value === "" || value.length >= 8, "Use at least 8 characters."),
});

export type UserCreateValues = z.infer<typeof userCreateSchema>;
export type UserUpdateValues = z.infer<typeof userUpdateSchema>;

/**
 * Readable temporary password (no ambiguous 0/O/1/l). There is no mail
 * provider, so the admin copies this once and shares it out-of-band.
 */
export function generatePassword(length = 14): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
