/** Mirrors the `commerce.payment_status` enum. */
export type PaymentStatus =
  | "pending"
  | "authorized"
  | "paid"
  | "failed"
  | "refunded"
  | "partially_refunded"
  | "voided";

export interface ProviderContext {
  credentials: Record<string, unknown>;
  mode: "test" | "live";
}

export interface PaymentIntentInput {
  orderId: string;
  orderNumber: string;
  amountCents: number;
  currencyCode: string;
  email: string;
  /** Order tax in cents, for gateways that display a tax breakdown. */
  taxCents?: number;
  returnUrl?: string;
}

export interface PaymentIntentResult {
  providerRef: string;
  status: PaymentStatus;
  /** Provider-specific payload for the client (redirect URL, widget params…). */
  clientPayload: Record<string, unknown>;
}

export interface WebhookEvent {
  eventId: string;
  providerRef: string;
  /** The gateway's own transaction id, when it differs from the reference. */
  providerTransactionId?: string;
  status: PaymentStatus;
  amountCents: number;
  method?: string | null;
  /** When the gateway says the event happened; used to drop out-of-order events. */
  occurredAt?: string;
  raw?: unknown;
}

export interface RefundResult {
  providerRef: string;
  status: PaymentStatus;
  amountCents: number;
}

/**
 * A payment gateway. Implementations are stateless: credentials and mode come
 * from `commerce.payment_providers`, so the same provider can run in test and
 * live mode without code changes.
 */
export interface PaymentProvider {
  readonly slug: string;
  /** Human label for storefronts. */
  readonly displayName: string;
  /** Payment method types this gateway offers (e.g. CARD, PSE, NEQUI). */
  readonly methods: readonly string[];
  /** ISO currency codes this gateway can charge. */
  readonly currencies: readonly string[];
  createIntent(input: PaymentIntentInput, ctx: ProviderContext): Promise<PaymentIntentResult>;
  /** Authenticate and decode a gateway webhook; throws `HTTPException` on bad input. */
  verifyWebhook(request: Request, ctx: ProviderContext): Promise<WebhookEvent>;
  refund(providerRef: string, amountCents: number, ctx: ProviderContext): Promise<RefundResult>;
}
