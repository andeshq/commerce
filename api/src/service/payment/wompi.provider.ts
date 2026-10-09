import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { ORDER_EXPIRY_MINUTES } from "../../config/config.ts";
import type {
  PaymentIntentInput,
  PaymentIntentResult,
  PaymentProvider,
  ProviderContext,
  RefundResult,
  WebhookEvent,
} from "./provider.ts";

/** Credentials stored in `payment_providers.credentials` for Wompi. */
interface WompiCredentials {
  publicKey?: string;
  privateKey?: string;
  integritySecret?: string;
  eventsSecret?: string;
}

/** Same for both environments; the key prefix selects sandbox vs production. */
const CHECKOUT_URL = "https://checkout.wompi.co/p/";

/** Maps Wompi transaction statuses to `commerce.payment_status`. */
const STATUS_MAP: Record<string, WebhookEvent["status"]> = {
  PENDING: "pending",
  APPROVED: "paid",
  DECLINED: "failed",
  VOIDED: "voided",
  ERROR: "failed",
};

function sha256hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** `<Reference><Amount><Currency><IntegritySecret>`, per Wompi's spec. */
export function wompiIntegritySignature(
  reference: string,
  amountCents: number,
  currency: string,
  integritySecret: string,
): string {
  return sha256hex(`${reference}${amountCents}${currency}${integritySecret}`);
}

/** Concatenates the event's `properties` values, the timestamp and the secret. */
export function wompiEventChecksum(
  data: unknown,
  properties: string[],
  timestamp: string | number,
  eventsSecret: string,
): string {
  return sha256hex(
    properties.map((path) => readPath(data, path)).join("") + String(timestamp) + eventsSecret,
  );
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a.toLowerCase());
  const right = Buffer.from(b.toLowerCase());
  return left.length === right.length && timingSafeEqual(left, right);
}

function credentials(ctx: ProviderContext): WompiCredentials {
  return (ctx.credentials ?? {}) as WompiCredentials;
}

function apiBase(mode: ProviderContext["mode"]): string {
  return mode === "live"
    ? "https://production.wompi.co/v1"
    : "https://sandbox.wompi.co/v1";
}

/** Resolve `transaction.id`-style paths inside the event `data` object. */
function readPath(source: unknown, path: string): string {
  let current: unknown = source;
  for (const key of path.split(".")) {
    if (typeof current !== "object" || current === null) return "";
    current = (current as Record<string, unknown>)[key];
  }
  return current === undefined || current === null ? "" : String(current);
}

/**
 * Wompi (Colombia). Uses **Web Checkout**: the storefront redirects the customer
 * to a signed URL, and confirmation arrives as a `transaction.updated` event.
 * Keys and secrets live in the database (`payment_providers.credentials`).
 */
export const wompiProvider: PaymentProvider = {
  slug: "wompi",
  displayName: "Wompi",
  methods: ["CARD", "PSE", "NEQUI", "BANCOLOMBIA_TRANSFER"],
  currencies: ["COP"],

  async createIntent(input: PaymentIntentInput, ctx: ProviderContext): Promise<PaymentIntentResult> {
    const { publicKey, integritySecret } = credentials(ctx);
    if (!publicKey || !integritySecret) {
      throw new HTTPException(409, {
        message: "Wompi is missing its public key or integrity secret.",
      });
    }
    if (input.currencyCode !== "COP") {
      throw new HTTPException(409, { message: "Wompi only supports COP." });
    }

    // Unique per attempt: Wompi rejects a reference that was already used.
    const reference = `${input.orderNumber}-${randomUUID().slice(0, 8)}`;
    const signature = wompiIntegritySignature(
      reference,
      input.amountCents,
      input.currencyCode,
      integritySecret,
    );

    const params = new URLSearchParams({
      "public-key": publicKey,
      currency: input.currencyCode,
      "amount-in-cents": String(input.amountCents),
      reference,
      "signature:integrity": signature,
    });
    if (input.email) params.set("customer-data:email", input.email);
    if (input.returnUrl) params.set("redirect-url", input.returnUrl);
    if (input.taxCents && input.taxCents > 0) {
      params.set("tax-in-cents:vat", String(input.taxCents));
    }
    // Match the gateway's payment window to our unpaid-order expiry.
    params.set(
      "expiration-time",
      new Date(Date.now() + ORDER_EXPIRY_MINUTES * 60_000).toISOString(),
    );

    return {
      providerRef: reference,
      status: "pending",
      clientPayload: {
        provider: "wompi",
        reference,
        checkout_url: `${CHECKOUT_URL}?${params.toString()}`,
      },
    };
  },

  async verifyWebhook(request: Request, ctx: ProviderContext): Promise<WebhookEvent> {
    const { eventsSecret } = credentials(ctx);
    if (!eventsSecret) {
      throw new HTTPException(409, { message: "Wompi is missing its events secret." });
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      throw new HTTPException(400, { message: "Webhook body must be JSON." });
    }

    if (body?.event !== "transaction.updated" || !body?.data?.transaction) {
      throw new HTTPException(400, { message: "Unsupported Wompi event." });
    }

    const properties: unknown = body.signature?.properties;
    const timestamp: unknown = body.timestamp;
    const checksum: string | undefined =
      request.headers.get("X-Event-Checksum") ?? body.signature?.checksum;
    if (!Array.isArray(properties) || timestamp === undefined || !checksum) {
      throw new HTTPException(400, { message: "Wompi event is missing its signature." });
    }

    const concatenated = wompiEventChecksum(
      body.data,
      properties.map((path) => String(path)),
      String(timestamp),
      eventsSecret,
    );
    if (!safeEqual(concatenated, checksum)) {
      throw new HTTPException(401, { message: "Invalid Wompi event signature." });
    }

    const tx = body.data.transaction;
    const status = STATUS_MAP[String(tx.status)];
    if (!status) {
      throw new HTTPException(400, { message: `Unknown Wompi status "${tx.status}".` });
    }

    return {
      eventId: `${tx.id}:${tx.status}:${body.sent_at ?? timestamp}`,
      providerRef: String(tx.reference),
      providerTransactionId: String(tx.id),
      status,
      amountCents: Number(tx.amount_in_cents ?? 0),
      method: typeof tx.payment_method_type === "string" ? tx.payment_method_type : null,
      occurredAt:
        typeof body.sent_at === "string"
          ? body.sent_at
          : new Date(Number(timestamp) * 1000).toISOString(),
      raw: body,
    };
  },

  async refund(providerRef: string, amountCents: number, ctx: ProviderContext): Promise<RefundResult> {
    const { privateKey } = credentials(ctx);
    if (!privateKey) {
      throw new HTTPException(409, { message: "Wompi is missing its private key." });
    }

    // Wompi voids the whole card transaction; partial refunds need the refunds API.
    const response = await fetch(
      `${apiBase(ctx.mode)}/transactions/${encodeURIComponent(providerRef)}/void`,
      { method: "POST", headers: { Authorization: `Bearer ${privateKey}` } },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new HTTPException(502, {
        message: `Wompi void failed (${response.status}). ${detail}`.trim(),
      });
    }

    return { providerRef, status: "refunded", amountCents };
  },
};
