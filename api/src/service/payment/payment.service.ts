import { singleton } from "tsyringe";
import { HTTPException } from "hono/http-exception";
import { Database } from "../../database/database.ts";
import { fakeProvider } from "./fake.provider.ts";
import { wompiProvider } from "./wompi.provider.ts";
import type {
  PaymentIntentResult,
  PaymentProvider,
  PaymentStatus,
  ProviderContext,
} from "./provider.ts";

const PROVIDERS: Record<string, PaymentProvider> = {
  [fakeProvider.slug]: fakeProvider,
  [wompiProvider.slug]: wompiProvider,
};

export interface ProviderSummary {
  provider: string;
  enabled: boolean;
  mode: "test" | "live";
  configured: boolean;
  position: number;
  is_default: boolean;
}

/** Public view of an enabled gateway for storefronts (no config/secrets). */
export interface PaymentMethod {
  provider: string;
  name: string;
  methods: readonly string[];
  currencies: readonly string[];
  is_default: boolean;
}

export interface ProviderUpdate {
  enabled?: boolean;
  mode?: "test" | "live";
  credentials?: Record<string, unknown>;
  position?: number;
  is_default?: boolean;
}

/**
 * Payment orchestration. Gateway webhooks carry no session, so this service
 * runs on the owner connection (like `MediaService`/`SetupService`) and is the
 * privileged apply path for order/payment state.
 */
@singleton()
export class PaymentService {
  constructor(private readonly database: Database) {}

  private commerce() {
    return this.database.withSchema("commerce");
  }

  private async providerContext(
    slug: string,
  ): Promise<{ provider: PaymentProvider; ctx: ProviderContext }> {
    const provider = PROVIDERS[slug];
    if (!provider) {
      throw new HTTPException(404, { message: `Unknown payment provider "${slug}".` });
    }
    const row = await this.commerce()
      .selectFrom("payment_providers")
      .select(["enabled", "mode", "credentials"])
      .where("provider", "=", slug)
      .executeTakeFirst();
    if (!row || !row.enabled) {
      throw new HTTPException(409, { message: `Payment provider "${slug}" is not enabled.` });
    }
    return {
      provider,
      ctx: {
        credentials: (row.credentials as Record<string, unknown> | null) ?? {},
        mode: row.mode,
      },
    };
  }

  /** Start a payment for an order; the customer may pick among enabled providers. */
  async createIntent(
    orderToken: string,
    options: { provider?: string; method?: string; returnUrl?: string } = {},
  ): Promise<Record<string, unknown>> {
    const order = await this.commerce()
      .selectFrom("orders")
      .selectAll()
      .where("access_token", "=", orderToken)
      .executeTakeFirst();
    if (!order) throw new HTTPException(404, { message: "Order not found." });
    if (order.payment_status === "paid") {
      throw new HTTPException(409, { message: "This order is already paid." });
    }

    const slug = await this.resolveProvider(options.provider);
    const { provider, ctx } = await this.providerContext(slug);
    if (!provider.currencies.includes(order.currency_code)) {
      throw new HTTPException(409, {
        message: `${provider.displayName} does not support ${order.currency_code}.`,
      });
    }

    // Reuse a pending payment for the same provider so retries don't pile up.
    let payment = await this.commerce()
      .selectFrom("payments")
      .selectAll()
      .where("order_id", "=", order.id)
      .where("provider", "=", slug)
      .where("status", "=", "pending")
      .orderBy("created_at", "desc")
      .executeTakeFirst();

    if (!payment) {
      payment = await this.commerce()
        .insertInto("payments")
        .values({
          order_id: order.id,
          provider: slug,
          status: "pending",
          amount_cents: order.total_cents,
          currency_code: order.currency_code,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    }

    const intent: PaymentIntentResult = await provider.createIntent(
      {
        orderId: order.id,
        orderNumber: String(order.number),
        amountCents: Number(order.total_cents),
        currencyCode: order.currency_code,
        email: order.email,
        taxCents: Number(order.tax_cents),
        returnUrl: options.returnUrl,
      },
      ctx,
    );

    await this.commerce()
      .updateTable("payments")
      .set({
        provider_ref: intent.providerRef,
        method: options.method ?? payment.method,
        metadata: { intent: intent.clientPayload },
      })
      .where("id", "=", payment.id)
      .execute();

    return {
      provider: slug,
      provider_ref: intent.providerRef,
      status: intent.status,
      order_number: String(order.number),
      ...intent.clientPayload,
    };
  }

  /** Requested provider if enabled, else the default enabled, else any enabled. */
  private async resolveProvider(requested?: string): Promise<string> {
    if (requested) {
      const row = await this.commerce()
        .selectFrom("payment_providers")
        .select("provider")
        .where("provider", "=", requested)
        .where("enabled", "=", true)
        .executeTakeFirst();
      if (!row) {
        throw new HTTPException(409, { message: `Payment provider "${requested}" is not available.` });
      }
      return row.provider;
    }

    const row = await this.commerce()
      .selectFrom("payment_providers")
      .select("provider")
      .where("enabled", "=", true)
      .orderBy("is_default", "desc")
      .orderBy("position", "asc")
      .orderBy("provider", "asc")
      .executeTakeFirst();
    if (!row) throw new HTTPException(409, { message: "No payment provider is available." });
    return row.provider;
  }

  async handleWebhook(slug: string, request: Request): Promise<void> {
    const { provider, ctx } = await this.providerContext(slug);
    const event = await provider.verifyWebhook(request, ctx);
    await this.applyEvent(slug, event);
  }

  private async applyEvent(
    slug: string,
    event: {
      eventId: string;
      providerRef: string;
      providerTransactionId?: string;
      status: PaymentStatus;
      method?: string | null;
      occurredAt?: string;
      raw?: unknown;
    },
  ): Promise<void> {
    // Idempotency: a replayed event inserts nothing and returns early.
    const inserted = await this.commerce()
      .insertInto("payment_events")
      .values({ provider: slug, event_id: event.eventId, payload: event.raw ?? {} })
      .onConflict((oc) => oc.columns(["provider", "event_id"]).doNothing())
      .returning("id")
      .executeTakeFirst();
    if (!inserted) return;

    const payment = await this.commerce()
      .selectFrom("payments")
      .selectAll()
      .where("provider_ref", "=", event.providerRef)
      .executeTakeFirst();
    if (!payment) return;

    const metadata = { ...((payment.metadata as Record<string, unknown> | null) ?? {}) };
    const eventAt = event.occurredAt ? new Date(event.occurredAt).getTime() : Date.now();
    const lastAt = typeof metadata.last_event_at === "number" ? metadata.last_event_at : 0;
    const terminal = ["paid", "refunded", "partially_refunded", "voided"].includes(payment.status);
    const downgrade = ["pending", "failed"].includes(event.status);

    // The event is always recorded; a stale or regressive one is not applied.
    await this.commerce()
      .updateTable("payment_events")
      .set({ payment_id: payment.id })
      .where("id", "=", inserted.id)
      .execute();

    if (eventAt < lastAt || (terminal && downgrade)) {
      return;
    }

    if (event.providerTransactionId) {
      metadata.provider_transaction_id = event.providerTransactionId;
    }
    metadata.last_event_at = eventAt;

    await this.commerce()
      .updateTable("payments")
      .set({ status: event.status, method: event.method ?? payment.method, metadata })
      .where("id", "=", payment.id)
      .execute();

    await this.commerce()
      .updateTable("orders")
      .set({ payment_status: event.status })
      .where("id", "=", payment.order_id)
      .execute();

    await this.commerce()
      .insertInto("order_events")
      .values({
        order_id: payment.order_id,
        type: "payment",
        data: { status: event.status, provider: slug, event_id: event.eventId },
      })
      .execute();

    // Money arrived after the order was cancelled/expired: flag for review
    // rather than silently re-taking stock that may already be sold.
    if (event.status === "paid") {
      const order = await this.commerce()
        .selectFrom("orders")
        .select("status")
        .where("id", "=", payment.order_id)
        .executeTakeFirst();
      if (order?.status === "cancelled") {
        await this.commerce()
          .insertInto("order_events")
          .values({
            order_id: payment.order_id,
            type: "payment_after_cancel",
            data: {
              provider: slug,
              event_id: event.eventId,
              provider_transaction_id: metadata.provider_transaction_id ?? null,
            },
          })
          .execute();
      }
    }
  }

  /** Refund (partially or fully) the latest payment on an order. */
  async refund(orderId: string, amountCents?: number): Promise<Record<string, unknown>> {
    const order = await this.commerce()
      .selectFrom("orders")
      .selectAll()
      .where("id", "=", orderId)
      .executeTakeFirst();
    if (!order) throw new HTTPException(404, { message: "Order not found." });

    const payment = await this.commerce()
      .selectFrom("payments")
      .selectAll()
      .where("order_id", "=", orderId)
      .where("status", "in", ["paid", "authorized", "partially_refunded"])
      .orderBy("created_at", "desc")
      .executeTakeFirst();
    if (!payment) throw new HTTPException(409, { message: "This order has nothing to refund." });

    const amount = amountCents ?? Number(payment.amount_cents);
    if (amount <= 0 || amount > Number(payment.amount_cents)) {
      throw new HTTPException(400, { message: "Refund amount is out of range." });
    }

    const meta = (payment.metadata as Record<string, unknown> | null) ?? {};
    const reference =
      typeof meta.provider_transaction_id === "string"
        ? meta.provider_transaction_id
        : (payment.provider_ref ?? "");

    const { provider, ctx } = await this.providerContext(payment.provider);
    const result = await provider.refund(reference, amount, ctx);
    const status: PaymentStatus =
      amount >= Number(payment.amount_cents) ? "refunded" : "partially_refunded";

    await this.commerce()
      .updateTable("payments")
      .set({ status })
      .where("id", "=", payment.id)
      .execute();

    await this.commerce()
      .updateTable("orders")
      .set({ payment_status: status })
      .where("id", "=", orderId)
      .execute();

    await this.commerce()
      .insertInto("order_events")
      .values({
        order_id: orderId,
        type: "refunded",
        data: { amount_cents: String(result.amountCents), provider: payment.provider },
      })
      .execute();

    return { status, amount_cents: String(result.amountCents), provider: payment.provider };
  }

  async listProviders(): Promise<ProviderSummary[]> {
    const rows = await this.commerce()
      .selectFrom("payment_providers")
      .select(["provider", "enabled", "mode", "credentials", "position", "is_default"])
      .orderBy("position", "asc")
      .orderBy("provider", "asc")
      .execute();

    return rows.map((row) => ({
      provider: row.provider,
      enabled: row.enabled,
      mode: row.mode,
      configured: Object.keys((row.credentials as Record<string, unknown> | null) ?? {}).length > 0,
      position: row.position,
      is_default: row.is_default,
    }));
  }

  /** Public: enabled gateways a storefront can offer, in display order. */
  async listMethods(): Promise<PaymentMethod[]> {
    const rows = await this.commerce()
      .selectFrom("payment_providers")
      .select(["provider", "is_default"])
      .where("enabled", "=", true)
      .orderBy("is_default", "desc")
      .orderBy("position", "asc")
      .orderBy("provider", "asc")
      .execute();

    return rows
      .map((row) => {
        const provider = PROVIDERS[row.provider];
        if (!provider) return null;
        return {
          provider: provider.slug,
          name: provider.displayName,
          methods: provider.methods,
          currencies: provider.currencies,
          is_default: row.is_default,
        } satisfies PaymentMethod;
      })
      .filter((entry): entry is PaymentMethod => entry !== null);
  }

  async updateProvider(slug: string, input: ProviderUpdate): Promise<ProviderSummary> {
    const patch: {
      enabled?: boolean;
      mode?: "test" | "live";
      credentials?: unknown;
      position?: number;
      is_default?: boolean;
    } = {};
    if (typeof input.enabled === "boolean") patch.enabled = input.enabled;
    if (input.mode === "test" || input.mode === "live") patch.mode = input.mode;
    if (input.credentials && typeof input.credentials === "object") {
      patch.credentials = input.credentials;
    }
    if (typeof input.position === "number") patch.position = input.position;
    if (typeof input.is_default === "boolean") patch.is_default = input.is_default;
    if (Object.keys(patch).length === 0) {
      throw new HTTPException(400, { message: "Nothing to update." });
    }

    // Only one provider may be the default (partial unique index).
    if (patch.is_default === true) {
      await this.commerce()
        .updateTable("payment_providers")
        .set({ is_default: false })
        .where("provider", "<>", slug)
        .execute();
    }

    const row = await this.commerce()
      .updateTable("payment_providers")
      .set(patch)
      .where("provider", "=", slug)
      .returning(["provider", "enabled", "mode", "credentials", "position", "is_default"])
      .executeTakeFirst();
    if (!row) throw new HTTPException(404, { message: `Unknown payment provider "${slug}".` });

    return {
      provider: row.provider,
      enabled: row.enabled,
      mode: row.mode,
      configured: Object.keys((row.credentials as Record<string, unknown> | null) ?? {}).length > 0,
      position: row.position,
      is_default: row.is_default,
    };
  }
}
