import { useState, type Key } from "react";
import { Button, Card, Chip, Dropdown, Label } from "@heroui/react";
import { ChevronDown } from "@gravity-ui/icons";
import { redirect, useLoaderData, useRevalidator } from "react-router";
import { PageHeader } from "@/lib/page-header";
import { pgbase, pgbaseErrorMessages } from "@/lib/pgbase";
import { useAdminStore } from "@/routes/admin/adminLayout";
import {
  formatMoney,
  type FulfillmentStatus,
  type Order,
  type OrderEvent,
  type OrderItem,
  type Payment,
  type PaymentStatus,
} from "@/lib/catalog";

const PAYMENT_COLOR: Record<PaymentStatus, "success" | "warning" | "danger" | "default"> = {
  paid: "success",
  pending: "warning",
  authorized: "warning",
  failed: "danger",
  refunded: "default",
  partially_refunded: "default",
  voided: "danger",
};

const FULFILLMENT_COLOR: Record<FulfillmentStatus, "success" | "default"> = {
  fulfilled: "success",
  unfulfilled: "default",
  partially_fulfilled: "default",
};

export async function orderDetailLoader({ params }: { params: { id?: string } }) {
  const id = String(params.id);
  const [order, items, payments, events] = await Promise.all([
    pgbase.from("orders").select("*").eq("id", id).maybeSingle().throwOnError(),
    pgbase
      .from("order_items")
      .select(
        "id,order_id,variant_id,product_id,product_title,variant_title,sku,quantity,unit_price_cents::text,unit_compare_at_cents::text,tax_cents::text,total_cents::text,created_at",
      )
      .eq("order_id", id)
      .order("created_at", { ascending: true })
      .throwOnError(),
    pgbase
      .from("payments")
      .select(
        "id,order_id,provider,method,status,amount_cents::text,currency_code,provider_ref,created_at,updated_at",
      )
      .eq("order_id", id)
      .order("created_at", { ascending: true })
      .throwOnError(),
    pgbase
      .from("order_events")
      .select("id,order_id,type,data,actor_id,actor_name,created_at")
      .eq("order_id", id)
      .order("created_at", { ascending: false })
      .throwOnError(),
  ]);

  if (!order.data) throw redirect("/admin/orders");

  return {
    order: order.data as Order,
    items: items.data as unknown as OrderItem[],
    payments: payments.data as unknown as Payment[],
    events: events.data as OrderEvent[],
  };
}

function addressLines(address: Record<string, unknown> | null): string[] {
  if (!address) return [];
  const pick = (key: string) => (typeof address[key] === "string" ? (address[key] as string) : "");
  const locality = [pick("city"), pick("region")].filter(Boolean).join(", ");
  const tail = [pick("postalCode"), pick("country")].filter(Boolean).join(" ");
  return [pick("line1"), pick("line2"), locality, tail].filter(Boolean);
}

export function OrderDetail() {
  const { order, items, payments, events } = useLoaderData<
    Awaited<ReturnType<typeof orderDetailLoader>>
  >();
  const store = useAdminStore();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const money = (value: string | number) =>
    store ? formatMoney(value, store.currency_code, store.locale) : String(value);

  async function run(rawKey: Key) {
    const key = String(rawKey);
    if (key === "cancel" && !window.confirm(`Cancel order #${order.number} and restock it?`)) {
      return;
    }
    if (key === "refund" && !window.confirm(`Refund order #${order.number}?`)) return;

    setBusy(true);
    setError(null);
    try {
      if (key === "refund") {
        const res = await fetch(`/api/orders/${order.id}/refund`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { message?: string } | null;
          throw new Error(body?.message ?? "Refund failed.");
        }
      } else {
        const fn =
          key === "paid"
            ? "order_mark_paid"
            : key === "fulfill"
              ? "order_fulfill"
              : "order_cancel";
        await pgbase.rpc(fn, { order_uuid: order.id }).throwOnError();
      }
      revalidator.revalidate();
    } catch (caught) {
      const messages = pgbaseErrorMessages(caught);
      setError(messages[0] ?? (caught instanceof Error ? caught.message : "Something went wrong."));
    } finally {
      setBusy(false);
    }
  }

  const canFulfill = order.status !== "cancelled" && order.fulfillment_status !== "fulfilled";
  const canCancel = order.status !== "cancelled";
  const canRefund = ["paid", "partially_refunded"].includes(order.payment_status);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`Order #${order.number}`}
        description={`${order.email} · ${new Date(order.placed_at).toLocaleString()}`}
        actions={
          <Dropdown>
            <Button variant="secondary" isDisabled={busy}>
              Actions
              <ChevronDown className="size-4 text-muted" />
            </Button>
            <Dropdown.Popover>
              <Dropdown.Menu onAction={run}>
                {order.payment_status !== "paid" && canCancel && (
                  <Dropdown.Item id="paid" textValue="Mark as paid">
                    <Label>Mark as paid</Label>
                  </Dropdown.Item>
                )}
                {canFulfill && (
                  <Dropdown.Item id="fulfill" textValue="Mark as fulfilled">
                    <Label>Mark as fulfilled</Label>
                  </Dropdown.Item>
                )}
                {canRefund && (
                  <Dropdown.Item id="refund" textValue="Refund" variant="danger">
                    <Label>Refund</Label>
                  </Dropdown.Item>
                )}
                {canCancel && (
                  <Dropdown.Item id="cancel" textValue="Cancel order" variant="danger">
                    <Label>Cancel order</Label>
                  </Dropdown.Item>
                )}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        }
      />

      {error && (
        <Card>
          <Card.Content className="text-sm text-danger">{error}</Card.Content>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <Card.Header>
            <Card.Title>Items</Card.Title>
          </Card.Header>
          <Card.Content className="flex flex-col gap-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-start justify-between gap-4 border-b border-field-border pb-3 last:border-b-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.product_title}</p>
                  <p className="truncate text-xs text-muted">
                    {item.variant_title}
                    {item.sku ? ` · ${item.sku}` : ""}
                  </p>
                </div>
                <div className="text-right text-sm tabular-nums">
                  <p>{money(item.total_cents)}</p>
                  <p className="text-xs text-muted">
                    {item.quantity} × {money(item.unit_price_cents)}
                  </p>
                </div>
              </div>
            ))}
          </Card.Content>
          <Card.Footer className="flex-col items-stretch gap-1 text-sm">
            <Row label="Subtotal" value={money(order.subtotal_cents)} />
            {Number(order.discount_cents) > 0 && (
              <Row label="Discount" value={`− ${money(order.discount_cents)}`} />
            )}
            {Number(order.tax_cents) > 0 && <Row label="Tax" value={money(order.tax_cents)} />}
            {Number(order.shipping_cents) > 0 && (
              <Row label="Shipping" value={money(order.shipping_cents)} />
            )}
            <div className="mt-1 flex justify-between border-t border-field-border pt-2 font-medium">
              <span>Total</span>
              <span className="tabular-nums">{money(order.total_cents)}</span>
            </div>
          </Card.Footer>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <Card.Header>
              <Card.Title>Status</Card.Title>
            </Card.Header>
            <Card.Content className="flex flex-wrap gap-2">
              <Chip size="sm" variant="soft">
                {order.status}
              </Chip>
              <Chip color={PAYMENT_COLOR[order.payment_status]} size="sm" variant="soft">
                {order.payment_status.replace(/_/g, " ")}
              </Chip>
              <Chip color={FULFILLMENT_COLOR[order.fulfillment_status]} size="sm" variant="soft">
                {order.fulfillment_status.replace(/_/g, " ")}
              </Chip>
            </Card.Content>
          </Card>

          <Card>
            <Card.Header>
              <Card.Title>Customer</Card.Title>
            </Card.Header>
            <Card.Content className="flex flex-col gap-3 text-sm">
              <p>{order.email}</p>
              {order.phone && <p className="text-muted">{order.phone}</p>}
              {addressLines(order.shipping_address).length > 0 && (
                <div>
                  <p className="text-xs text-muted uppercase">Ship to</p>
                  {addressLines(order.shipping_address).map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              )}
              {order.note && (
                <div>
                  <p className="text-xs text-muted uppercase">Note</p>
                  <p>{order.note}</p>
                </div>
              )}
            </Card.Content>
          </Card>

          <Card>
            <Card.Header>
              <Card.Title>Payments</Card.Title>
            </Card.Header>
            <Card.Content className="flex flex-col gap-3">
              {payments.length === 0 ? (
                <p className="text-sm text-muted">No payments.</p>
              ) : (
                payments.map((payment) => (
                  <div key={payment.id} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium capitalize">{payment.provider}</p>
                      <p className="truncate text-xs text-muted">
                        {payment.method ?? "—"}
                        {payment.provider_ref ? ` · ${payment.provider_ref}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <Chip color={PAYMENT_COLOR[payment.status]} size="sm" variant="soft">
                        {payment.status.replace(/_/g, " ")}
                      </Chip>
                      <p className="mt-1 text-xs tabular-nums">{money(payment.amount_cents)}</p>
                    </div>
                  </div>
                ))
              )}
            </Card.Content>
          </Card>

          <Card>
            <Card.Header>
              <Card.Title>Timeline</Card.Title>
            </Card.Header>
            <Card.Content className="flex flex-col gap-3">
              {events.map((event) => (
                <div key={event.id} className="text-sm">
                  <p className="font-medium capitalize">{event.type.replace(/_/g, " ")}</p>
                  <p className="text-xs text-muted">
                    {new Date(event.created_at).toLocaleString()}
                    {event.actor_name ? ` · ${event.actor_name}` : ""}
                  </p>
                </div>
              ))}
            </Card.Content>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/* React Router lazy-route contract. */
export { OrderDetail as Component, orderDetailLoader as loader };
