import { useMemo, useState } from "react";
import { Button, Card, Chip, Dropdown, Label, Link, SearchField, Table } from "@heroui/react";
import type { SortDescriptor } from "@heroui/react";
import { BarsDescendingAlignLeft } from "@gravity-ui/icons";
import { useLoaderData } from "react-router";
import { PageHeader } from "@/lib/page-header";
import { pgbase } from "@/lib/pgbase";
import { useAdminStore } from "@/routes/admin/adminLayout";
import { formatMoney, type Order, type PaymentStatus, type FulfillmentStatus } from "@/lib/catalog";

const PAYMENT_FILTERS = [
  { id: "all", label: "All payments" },
  { id: "pending", label: "Pending" },
  { id: "paid", label: "Paid" },
  { id: "refunded", label: "Refunded" },
  { id: "partially_refunded", label: "Partially refunded" },
] as const;

const FULFILLMENT_FILTERS = [
  { id: "all", label: "All fulfillment" },
  { id: "unfulfilled", label: "Unfulfilled" },
  { id: "fulfilled", label: "Fulfilled" },
] as const;

const SORT_OPTIONS = [
  { id: "placed_at", label: "Newest", direction: "descending" },
  { id: "number", label: "Order number", direction: "descending" },
  { id: "total_cents", label: "Total", direction: "descending" },
] as const;

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

export async function orderListingLoader() {
  const [orders, items] = await Promise.all([
    pgbase
      .from("orders")
      .select(
        "id,number,email,customer_id,status,payment_status,fulfillment_status,currency_code,subtotal_cents,total_cents,placed_at",
      )
      .order("placed_at", { ascending: false })
      .throwOnError(),
    pgbase.from("order_items").select("order_id,quantity").throwOnError(),
  ]);

  const itemCount = new Map<string, number>();
  for (const item of items.data as Array<{ order_id: string; quantity: number }>) {
    itemCount.set(item.order_id, (itemCount.get(item.order_id) ?? 0) + item.quantity);
  }

  return { orders: orders.data as Order[], itemCount: [...itemCount.entries()] };
}

export function OrderListing() {
  const { orders, itemCount } = useLoaderData<Awaited<ReturnType<typeof orderListingLoader>>>();
  const store = useAdminStore();

  const counts = useMemo(() => new Map(itemCount), [itemCount]);
  const [query, setQuery] = useState("");
  const [payment, setPayment] = useState<(typeof PAYMENT_FILTERS)[number]["id"]>("all");
  const [fulfillment, setFulfillment] = useState<(typeof FULFILLMENT_FILTERS)[number]["id"]>("all");
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: "placed_at",
    direction: "descending",
  });

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const column = String(sortDescriptor.column);
    const direction = sortDescriptor.direction === "descending" ? -1 : 1;

    return orders
      .filter((order) => {
        if (payment !== "all" && order.payment_status !== payment) return false;
        if (fulfillment !== "all" && order.fulfillment_status !== fulfillment) return false;
        if (!term) return true;
        return [String(order.number), order.email].some((value) =>
          value.toLowerCase().includes(term),
        );
      })
      .sort((a, b) => {
        switch (column) {
          case "number":
            return (Number(a.number) - Number(b.number)) * direction;
          case "total_cents":
            return (Number(a.total_cents) - Number(b.total_cents)) * direction;
          default:
            return (new Date(a.placed_at).getTime() - new Date(b.placed_at).getTime()) * direction;
        }
      });
  }, [orders, query, payment, fulfillment, sortDescriptor]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Orders"
        description="Everything customers have ordered, newest first."
      />

      <Card>
        <Card.Header className="flex-row flex-wrap items-center justify-between gap-3">
          <SearchField
            aria-label="Search orders"
            variant="secondary"
            value={query}
            onChange={setQuery}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input className="w-56" placeholder="Order number or email" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>

          <div className="flex flex-wrap items-center gap-2">
            <Dropdown>
              <Button size="sm" variant="secondary">
                {PAYMENT_FILTERS.find((option) => option.id === payment)?.label}
              </Button>
              <Dropdown.Popover>
                <Dropdown.Menu
                  selectedKeys={[payment]}
                  selectionMode="single"
                  onSelectionChange={(keys) => {
                    const [key] = [...keys];
                    if (typeof key === "string") setPayment(key as typeof payment);
                  }}
                >
                  {PAYMENT_FILTERS.map((option) => (
                    <Dropdown.Item key={option.id} id={option.id} textValue={option.label}>
                      <Label>{option.label}</Label>
                      <Dropdown.ItemIndicator />
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>

            <Dropdown>
              <Button size="sm" variant="secondary">
                {FULFILLMENT_FILTERS.find((option) => option.id === fulfillment)?.label}
              </Button>
              <Dropdown.Popover>
                <Dropdown.Menu
                  selectedKeys={[fulfillment]}
                  selectionMode="single"
                  onSelectionChange={(keys) => {
                    const [key] = [...keys];
                    if (typeof key === "string") setFulfillment(key as typeof fulfillment);
                  }}
                >
                  {FULFILLMENT_FILTERS.map((option) => (
                    <Dropdown.Item key={option.id} id={option.id} textValue={option.label}>
                      <Label>{option.label}</Label>
                      <Dropdown.ItemIndicator />
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>

            <Dropdown>
              <Button size="sm" variant="secondary">
                <BarsDescendingAlignLeft className="size-4" />
                Sort by
              </Button>
              <Dropdown.Popover>
                <Dropdown.Menu
                  selectedKeys={[String(sortDescriptor.column)]}
                  selectionMode="single"
                  onSelectionChange={(keys) => {
                    const [key] = [...keys];
                    const option = SORT_OPTIONS.find((item) => item.id === key);
                    if (option) {
                      setSortDescriptor({
                        column: option.id,
                        direction: option.direction,
                      });
                    }
                  }}
                >
                  {SORT_OPTIONS.map((option) => (
                    <Dropdown.Item key={option.id} id={option.id} textValue={option.label}>
                      <Label>{option.label}</Label>
                      <Dropdown.ItemIndicator />
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>
        </Card.Header>

        <Card.Content>
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              {orders.length === 0 ? "No orders yet." : "No orders match these filters."}
            </p>
          ) : (
            <Table>
              <Table.ScrollContainer>
                <Table.Content
                  aria-label="Orders"
                  className="min-w-[820px]"
                  sortDescriptor={sortDescriptor}
                  onSortChange={setSortDescriptor}
                >
                  <Table.Header>
                    <Table.Column allowsSorting id="number" isRowHeader>
                      {({ sortDirection }) => (
                        <Table.SortableColumnHeader sortDirection={sortDirection}>
                          Order
                        </Table.SortableColumnHeader>
                      )}
                    </Table.Column>
                    <Table.Column>Customer</Table.Column>
                    <Table.Column>Payment</Table.Column>
                    <Table.Column>Fulfillment</Table.Column>
                    <Table.Column allowsSorting id="total_cents">
                      {({ sortDirection }) => (
                        <Table.SortableColumnHeader sortDirection={sortDirection}>
                          Total
                        </Table.SortableColumnHeader>
                      )}
                    </Table.Column>
                    <Table.Column allowsSorting id="placed_at">
                      {({ sortDirection }) => (
                        <Table.SortableColumnHeader sortDirection={sortDirection}>
                          Date
                        </Table.SortableColumnHeader>
                      )}
                    </Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {rows.map((order) => (
                      <Table.Row key={order.id} id={order.id}>
                        <Table.Cell>
                          <Link
                            className="font-medium no-underline"
                            href={`/admin/orders/${order.id}`}
                          >
                            #{order.number}
                          </Link>
                          <span className="ms-2 text-xs text-muted">
                            {counts.get(order.id) ?? 0} item
                            {(counts.get(order.id) ?? 0) === 1 ? "" : "s"}
                          </span>
                        </Table.Cell>
                        <Table.Cell>{order.email}</Table.Cell>
                        <Table.Cell>
                          <Chip color={PAYMENT_COLOR[order.payment_status]} size="sm" variant="soft">
                            {order.payment_status.replace(/_/g, " ")}
                          </Chip>
                        </Table.Cell>
                        <Table.Cell>
                          <Chip
                            color={FULFILLMENT_COLOR[order.fulfillment_status]}
                            size="sm"
                            variant="soft"
                          >
                            {order.fulfillment_status.replace(/_/g, " ")}
                          </Chip>
                        </Table.Cell>
                        <Table.Cell className="tabular-nums">
                          {store
                            ? formatMoney(order.total_cents, store.currency_code, store.locale)
                            : String(order.total_cents)}
                        </Table.Cell>
                        <Table.Cell className="text-muted">
                          {new Date(order.placed_at).toLocaleDateString()}
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          )}
        </Card.Content>
      </Card>
    </div>
  );
}

/* React Router lazy-route contract. */
export { OrderListing as Component, orderListingLoader as loader };
