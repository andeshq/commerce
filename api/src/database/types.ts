import type { ColumnType, Generated } from "kysely";

type Timestamps = {
  created_at: ColumnType<Date, string | undefined, never>;
  updated_at: ColumnType<Date, string | undefined, string>;
};

type Timestampped = {
  updated_at: ColumnType<Date, string | undefined, string>;
};

export interface MigrationTable {
  name: string;
  timestamp: string;
}

export interface DatabaseSchema {
  kysely_migration: MigrationTable;
  kysely_migration_lock: { id: string; is_locked: number };

  store_settings: {
    id: boolean;
    name: string;
    currency_code: string;
    locale: string;
    prices_include_tax: boolean;
    tax_rate_bps: number;
    tax_label: string;
    metadata: unknown;
  } & Timestamps;

  media: {
    id: Generated<string>;
    url: string;
    alt: string | null;
    content_type: string | null;
    width: number | null;
    height: number | null;
    metadata: unknown;
  } & Timestamps;

  categories: {
    id: Generated<string>;
    parent_id: string | null;
    name: string;
    slug: string;
    description: string | null;
    position: number;
    metadata: unknown;
  } & Timestamps;

  collections: {
    id: Generated<string>;
    name: string;
    slug: string;
    description: string | null;
    type: "manual" | "smart";
    rules: unknown;
    position: number;
    metadata: unknown;
  } & Timestamps;

  products: {
    id: Generated<string>;
    title: string;
    slug: string;
    description: string | null;
    status: "draft" | "active" | "archived";
    vendor: string | null;
    product_type: string | null;
    category_id: string | null;
    published_at: Date | null;
    metadata: unknown;
  } & Timestamps;

  product_collections: {
    product_id: string;
    collection_id: string;
    position: number;
  };

  options: {
    id: Generated<string>;
    name: string;
    position: number;
  } & Timestamps;

  option_values: {
    id: Generated<string>;
    option_id: string;
    value: string;
    position: number;
  } & Timestamps;

  product_options: {
    product_id: string;
    option_id: string;
    position: number;
  };

  modifier_groups: {
    id: Generated<string>;
    name: string;
    selection_type: "single" | "multiple";
    required: boolean;
    position: number;
  } & Timestamps;

  modifier_values: {
    id: Generated<string>;
    group_id: string;
    name: string;
    price_delta_cents: number | bigint;
    position: number;
  } & Timestamps;

  product_modifier_groups: {
    product_id: string;
    group_id: string;
    position: number;
  };

  product_variants: {
    id: Generated<string>;
    product_id: string;
    sku: string | null;
    barcode: string | null;
    title: string;
    position: number;
    price_cents: number | bigint;
    compare_at_price_cents: number | bigint | null;
    weight_grams: number | null;
    requires_shipping: boolean;
    taxable: boolean;
    tax_rate_bps: number | null;
    metadata: unknown;
  } & Timestamps;

  product_variant_costs: {
    variant_id: string;
    cost_cents: number | bigint;
  } & Timestamps;

  variant_option_values: {
    variant_id: string;
    option_value_id: string;
  };

  product_media: {
    product_id: string;
    media_id: string;
    position: number;
  };

  variant_media: {
    variant_id: string;
    media_id: string;
    position: number;
  };

  inventory_locations: {
    id: Generated<string>;
    name: string;
    code: string | null;
    address: Generated<unknown>;
    active: Generated<boolean>;
    is_default: Generated<boolean>;
  } & Timestamps;

  inventory_levels: {
    variant_id: string;
    location_id: string;
    available: number;
    committed: number;
    reserved: number;
  } & Timestampped;

  inventory_movements: {
    id: Generated<string>;
    variant_id: string;
    location_id: string;
    delta: number;
    reason: string;
    reference: string | null;
    metadata: unknown;
    created_by: string | null;
    created_by_name: string | null;
    created_at: ColumnType<Date, string | undefined, never>;
  };

  orders: {
    id: Generated<string>;
    number: Generated<number | bigint>;
    access_token: Generated<string>;
    customer_id: string | null;
    email: string;
    phone: string | null;
    status: Generated<"open" | "completed" | "cancelled">;
    payment_status: Generated<
      | "pending"
      | "authorized"
      | "paid"
      | "failed"
      | "refunded"
      | "partially_refunded"
      | "voided"
    >;
    fulfillment_status: Generated<"unfulfilled" | "partially_fulfilled" | "fulfilled">;
    currency_code: string;
    subtotal_cents: Generated<number | bigint>;
    discount_cents: Generated<number | bigint>;
    tax_cents: Generated<number | bigint>;
    shipping_cents: Generated<number | bigint>;
    total_cents: Generated<number | bigint>;
    shipping_address: unknown;
    billing_address: unknown;
    note: string | null;
    idempotency_key: string | null;
    placed_at: Generated<Date>;
    metadata: unknown;
  } & Timestamps;

  order_items: {
    id: Generated<string>;
    order_id: string;
    variant_id: string | null;
    product_id: string | null;
    product_title: string;
    variant_title: string;
    sku: string | null;
    quantity: number;
    unit_price_cents: number | bigint;
    unit_compare_at_cents: number | bigint | null;
    tax_cents: Generated<number | bigint>;
    tax_rate_bps: Generated<number>;
    total_cents: number | bigint;
    metadata: unknown;
    created_at: ColumnType<Date, string | undefined, never>;
  };

  order_events: {
    id: Generated<string>;
    order_id: string;
    type: string;
    data: unknown;
    actor_id: string | null;
    actor_name: string | null;
    created_at: ColumnType<Date, string | undefined, never>;
  };

  payments: {
    id: Generated<string>;
    order_id: string;
    provider: string;
    method: string | null;
    status: Generated<
      | "pending"
      | "authorized"
      | "paid"
      | "failed"
      | "refunded"
      | "partially_refunded"
      | "voided"
    >;
    amount_cents: number | bigint;
    currency_code: string;
    provider_ref: string | null;
    metadata: unknown;
  } & Timestamps;

  payment_providers: {
    provider: string;
    enabled: Generated<boolean>;
    mode: Generated<"test" | "live">;
    position: Generated<number>;
    is_default: Generated<boolean>;
    credentials: unknown;
    metadata: unknown;
  } & Timestamps;

  payment_events: {
    id: Generated<string>;
    provider: string;
    event_id: string;
    payment_id: string | null;
    payload: unknown;
    created_at: ColumnType<Date, string | undefined, never>;
  };

  carts: {
    id: Generated<string>;
    token: Generated<string>;
    customer_id: string | null;
    email: string | null;
    currency_code: string;
    status: Generated<"open" | "converted" | "abandoned">;
    shipping_address: unknown;
    converted_order_id: string | null;
    metadata: unknown;
    converted_at: Date | null;
  } & Timestamps;

  cart_items: {
    id: Generated<string>;
    cart_id: string;
    variant_id: string;
    quantity: number;
    metadata: unknown;
  } & Timestamps;
}
