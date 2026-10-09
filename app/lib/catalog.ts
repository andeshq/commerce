export const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;

export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export interface Store {
  name: string;
  currency_code: string;
  locale: string;
  prices_include_tax: boolean;
  tax_rate_bps: number;
  tax_label: string;
}

export interface Product {
  id: string;
  title: string;
  slug: string;
  status: ProductStatus;
  description: string | null;
  vendor: string | null;
  product_type: string | null;
  category_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export type ModifierSelection = "single" | "multiple";

/** Store-scoped group of priced add-ons, attachable to any product. */
export interface ModifierGroup {
  id: string;
  name: string;
  selection_type: ModifierSelection;
  required: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface ModifierValue {
  id: string;
  group_id: string;
  name: string;
  price_delta_cents: string | number;
  position: number;
}

export interface ModifierGroupWithValues extends ModifierGroup {
  modifier_values: ModifierValue[];
}

export interface ProductModifierLink {
  product_id: string;
  group_id: string;
  position: number;
}

/** Store-scoped option (Square-style): reusable across products. */
export interface Option {
  id: string;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface OptionValue {
  id: string;
  option_id: string;
  value: string;
  position: number;
  /** Present when the query embedded its variant links (used for usage counts). */
  variant_option_values?: Array<{ variant_id: string }>;
}

export interface OptionWithValues extends Option {
  option_values: OptionValue[];
}

export interface Variant {
  id: string;
  product_id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  position: number;
  price_cents: string | number;
  compare_at_price_cents: string | number | null;
  weight_grams: number | null;
  requires_shipping: boolean;
  taxable: boolean;
  tax_rate_bps: number | null;
}

/** `product_variants` plus its option-value links and staff-only cost. */
export interface VariantWithLinks extends Variant {
  variant_option_values: Array<{ option_value_id: string }>;
  product_variant_costs: { cost_cents: string | number } | null;
}

export interface ProductOptionLink {
  product_id: string;
  option_id: string;
  position: number;
}

export interface Media {
  id: string;
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

export interface ProductMediaLink {
  product_id: string;
  media_id: string;
  position: number;
}

export interface ProductVariantCost {
  variant_id: string;
  cost_cents: string;
}

export interface VariantMediaLink {
  variant_id: string;
  media_id: string;
}

export interface LocationAddress {
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}

export interface InventoryLocation {
  id: string;
  name: string;
  code: string | null;
  address: LocationAddress;
  active: boolean;
  is_default: boolean;
}

export interface InventoryLevel {
  variant_id: string;
  location_id: string;
  available: number;
  updated_at: string;
}

export interface InventoryMovement {
  id: string;
  variant_id: string;
  location_id: string;
  delta: number;
  reason: string;
  reference: string | null;
  metadata: { note?: string } | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}

export type OrderStatus = "open" | "completed" | "cancelled";
export type PaymentStatus =
  | "pending"
  | "authorized"
  | "paid"
  | "failed"
  | "refunded"
  | "partially_refunded"
  | "voided";
export type FulfillmentStatus = "unfulfilled" | "partially_fulfilled" | "fulfilled";

export interface Order {
  id: string;
  number: string | number;
  access_token: string;
  customer_id: string | null;
  email: string;
  phone: string | null;
  status: OrderStatus;
  payment_status: PaymentStatus;
  fulfillment_status: FulfillmentStatus;
  currency_code: string;
  subtotal_cents: string | number;
  discount_cents: string | number;
  tax_cents: string | number;
  shipping_cents: string | number;
  total_cents: string | number;
  shipping_address: Record<string, unknown> | null;
  billing_address: Record<string, unknown> | null;
  note: string | null;
  placed_at: string;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  variant_id: string | null;
  product_id: string | null;
  product_title: string;
  variant_title: string;
  sku: string | null;
  quantity: number;
  unit_price_cents: string | number;
  unit_compare_at_cents: string | number | null;
  tax_cents: string | number;
  total_cents: string | number;
  created_at: string;
}

export interface Payment {
  id: string;
  order_id: string;
  provider: string;
  method: string | null;
  status: PaymentStatus;
  amount_cents: string | number;
  currency_code: string;
  provider_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderEvent {
  id: string;
  order_id: string;
  type: string;
  data: Record<string, unknown> | null;
  actor_id: string | null;
  actor_name: string | null;
  created_at: string;
}

/** URL-safe slug derived from a title. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** "Ropa / Camisetas" style label for a category, walking up its parents. */
export function categoryPath(categories: Category[], id: string): string {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const parts: string[] = [];
  const seen = new Set<string>();

  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.name);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }

  return parts.join(" / ");
}

/** The category itself plus every descendant. */
export function categoryDescendantIds(categories: Category[], id: string): Set<string> {
  const children = new Map<string | null, Category[]>();
  for (const category of categories) {
    const list = children.get(category.parent_id) ?? [];
    list.push(category);
    children.set(category.parent_id, list);
  }

  const ids = new Set<string>([id]);
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of children.get(current) ?? []) {
      if (ids.has(child.id)) continue;
      ids.add(child.id);
      queue.push(child.id);
    }
  }

  return ids;
}

/** Depth-first tree order (roots first, siblings by position), with depth. */
export function categoryTree(
  categories: Category[],
  compare: (a: Category, b: Category) => number = (a, b) =>
    a.position - b.position || a.name.localeCompare(b.name),
): Array<{ category: Category; depth: number }> {
  const children = new Map<string | null, Category[]>();
  for (const category of categories) {
    const list = children.get(category.parent_id) ?? [];
    list.push(category);
    children.set(category.parent_id, list);
  }

  const seen = new Set<string>();
  const rows: Array<{ category: Category; depth: number }> = [];

  function walk(parentId: string | null, depth: number) {
    const siblings = [...(children.get(parentId) ?? [])].sort(compare);
    for (const category of siblings) {
      if (seen.has(category.id)) continue;
      seen.add(category.id);
      rows.push({ category, depth });
      walk(category.id, depth + 1);
    }
  }

  walk(null, 0);
  return rows;
}

/**
 * Money is bigint cents. Postgres sends it as a string at the top level and as
 * a JSON number when embedded, so normalize before doing arithmetic.
 */
export function cents(value: string | number | bigint | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

/** Currency units as typed ("2000" or "1500.50") → integer cents. */
export function toCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

export function formatMoney(
  value: string | number | bigint | null | undefined,
  currency: string,
  locale: string,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: cents(value) % 100 === 0 ? 0 : 2,
  }).format(cents(value) / 100);
}

/** Currency symbol for price prefixes ("$", "€", …). */
export function currencySymbol(currency: string, locale: string): string {
  const parts = new Intl.NumberFormat(locale, { style: "currency", currency }).formatToParts(0);
  return parts.find((part) => part.type === "currency")?.value ?? currency;
}

/** "10 - 25" style range for multi-variant products. */
export function priceRange(
  prices: Array<string | number>,
  currency: string,
  locale: string,
): string | null {
  if (prices.length === 0) return null;
  const numbers = prices.map(cents).sort((a, b) => a - b);
  const min = numbers[0]!;
  const max = numbers[numbers.length - 1]!;
  if (min === max) return formatMoney(min, currency, locale);
  return `${formatMoney(min, currency, locale)} – ${formatMoney(max, currency, locale)}`;
}
