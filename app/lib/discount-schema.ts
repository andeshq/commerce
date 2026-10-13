import { z } from "zod";
import { m } from "@/paraglide/messages.js";
import { toCents } from "./catalog";

export const DISCOUNT_TYPES = ["percentage", "fixed"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

/**
 * The merchant types human units (10 for 10%, "2000" for $20.00); the DB stores
 * basis points for percentages and cents for fixed amounts. `discountPayload`
 * does the conversion and the range checks, so both the create and update
 * actions share one validator.
 */
export const discountSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, { error: () => m.discounts_code() })
    .regex(/^[A-Za-z0-9_-]{2,64}$/, { error: () => m.discounts_code() }),
  type: z.enum(DISCOUNT_TYPES),
  value: z
    .string()
    .trim()
    .min(1, { error: () => m.discounts_value() }),
  minSubtotal: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  usageLimit: z.string(),
  active: z.boolean(),
});

export type DiscountFormValues = z.infer<typeof discountSchema>;

export interface DiscountRecord {
  code: string;
  type: DiscountType;
  value: number;
  min_subtotal_cents: number | string;
  starts_at: string | null;
  ends_at: string | null;
  usage_limit: number | null;
  active: boolean;
}

export interface DiscountPayload {
  code: string;
  type: DiscountType;
  value: number;
  min_subtotal_cents: number;
  starts_at: string | null;
  ends_at: string | null;
  usage_limit: number | null;
  active: boolean;
}

export function discountPayload(
  values: DiscountFormValues,
): { ok: true; data: DiscountPayload } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  let value = 0;

  if (values.type === "percentage") {
    const percent = Number(values.value.replace(",", "."));
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      errors.push(m.discounts_value_hint());
    } else {
      value = Math.round(percent * 100);
    }
  } else {
    const cents = toCents(values.value);
    if (cents === null || cents <= 0) {
      errors.push(m.discounts_value_hint());
    } else {
      value = cents;
    }
  }

  const minSubtotal = values.minSubtotal.trim() ? toCents(values.minSubtotal) : 0;
  if (minSubtotal === null || minSubtotal < 0) {
    errors.push(m.discounts_min_subtotal_hint());
  }

  let usageLimit: number | null = null;
  if (values.usageLimit.trim()) {
    const parsed = Number(values.usageLimit);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      errors.push(m.discounts_usage_limit_hint());
    } else {
      usageLimit = parsed;
    }
  }

  const startsAt = values.startsAt ? new Date(values.startsAt) : null;
  const endsAt = values.endsAt ? new Date(values.endsAt) : null;
  if (startsAt && endsAt && endsAt <= startsAt) {
    errors.push(m.discounts_window_hint());
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      code: values.code.trim().toUpperCase(),
      type: values.type,
      value,
      min_subtotal_cents: minSubtotal ?? 0,
      starts_at: startsAt ? startsAt.toISOString() : null,
      ends_at: endsAt ? endsAt.toISOString() : null,
      usage_limit: usageLimit,
      active: values.active,
    },
  };
}

/** ISO timestamp → `datetime-local` value (local time, no seconds). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function discountToForm(row: DiscountRecord): DiscountFormValues {
  return {
    code: row.code,
    type: row.type,
    value: String(row.value / 100),
    minSubtotal:
      Number(row.min_subtotal_cents) > 0 ? String(Number(row.min_subtotal_cents) / 100) : "",
    startsAt: toLocalInput(row.starts_at),
    endsAt: toLocalInput(row.ends_at),
    usageLimit: row.usage_limit === null ? "" : String(row.usage_limit),
    active: row.active,
  };
}
