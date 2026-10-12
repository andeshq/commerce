import { m } from "@/paraglide/messages.js";

/** Enum → translated label. Unknown values fall back to the raw value. */

export function productStatusLabel(status: string): string {
  switch (status) {
    case "active":
      return m.status_active();
    case "draft":
      return m.status_draft();
    case "archived":
      return m.status_archived();
    default:
      return status;
  }
}

export function roleLabel(role: string | null | undefined): string {
  switch (role) {
    case "admin":
      return m.role_admin();
    case "staff":
      return m.role_staff();
    case "customer":
      return m.role_customer();
    default:
      return role ?? "";
  }
}

export function paymentStatusLabel(status: string): string {
  switch (status) {
    case "paid":
      return m.payment_paid();
    case "pending":
      return m.payment_pending();
    case "authorized":
      return m.payment_authorized();
    case "failed":
      return m.payment_failed();
    case "refunded":
      return m.payment_refunded();
    case "partially_refunded":
      return m.payment_partially_refunded();
    case "voided":
      return m.payment_voided();
    default:
      return status;
  }
}

export function fulfillmentStatusLabel(status: string): string {
  switch (status) {
    case "unfulfilled":
      return m.fulfillment_unfulfilled();
    case "partially_fulfilled":
      return m.fulfillment_partially_fulfilled();
    case "fulfilled":
      return m.fulfillment_fulfilled();
    default:
      return status;
  }
}

export function orderStatusLabel(status: string): string {
  switch (status) {
    case "open":
      return m.order_status_open();
    case "completed":
      return m.order_status_completed();
    case "cancelled":
      return m.order_status_cancelled();
    default:
      return status;
  }
}

/** Simple count label; the message format here has no ICU plural support. */
export function itemCountLabel(count: number): string {
  return count === 1
    ? m.common_item_count_one({ count })
    : m.common_item_count_other({ count });
}
