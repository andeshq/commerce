import { HTTPException } from "hono/http-exception";
import type {
  PaymentIntentInput,
  PaymentIntentResult,
  PaymentProvider,
  ProviderContext,
  RefundResult,
  WebhookEvent,
} from "./provider.ts";

/**
 * A local provider that stands in for a real gateway: `createIntent` returns a
 * reference plus a client payload, and confirmation arrives through the webhook
 * endpoint (no signature in test mode). It lets cart → checkout → paid → admin
 * run end to end without a network call, and exercises the same webhook path a
 * real gateway will use.
 */
export const fakeProvider: PaymentProvider = {
  slug: "fake",
  displayName: "Test provider",
  methods: ["TEST"],
  currencies: ["COP", "USD"],

  async createIntent(input: PaymentIntentInput): Promise<PaymentIntentResult> {
    return {
      providerRef: `fake_${input.orderId}`,
      status: "pending",
      clientPayload: {
        provider: "fake",
        order_number: input.orderNumber,
        amount_cents: input.amountCents,
        currency: input.currencyCode,
        confirm: {
          method: "POST",
          url: "/api/payments/fake/webhook",
          body: {
            event_id: `fake_evt_${input.orderId}`,
            provider_ref: `fake_${input.orderId}`,
            status: "paid",
            amount_cents: input.amountCents,
          },
        },
      },
    };
  },

  async verifyWebhook(request: Request, _ctx: ProviderContext): Promise<WebhookEvent> {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new HTTPException(400, { message: "Webhook body must be JSON." });
    }

    const eventId = body.event_id;
    const providerRef = body.provider_ref;
    const status = body.status;
    if (typeof eventId !== "string" || typeof providerRef !== "string" || typeof status !== "string") {
      throw new HTTPException(400, {
        message: "Webhook needs event_id, provider_ref and status.",
      });
    }

    return {
      eventId,
      providerRef,
      status: status as WebhookEvent["status"],
      amountCents: Number(body.amount_cents ?? 0),
      method: typeof body.method === "string" ? body.method : null,
      occurredAt: typeof body.occurred_at === "string" ? body.occurred_at : new Date().toISOString(),
      raw: body,
    };
  },

  async refund(providerRef: string, amountCents: number): Promise<RefundResult> {
    return {
      providerRef,
      status: amountCents > 0 ? "refunded" : "voided",
      amountCents,
    };
  },
};
