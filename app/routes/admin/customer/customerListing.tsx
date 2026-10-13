import { Card, Chip, SearchField, Table } from "@heroui/react";
import { useMemo, useState } from "react";
import { redirect, useLoaderData } from "react-router";
import { getSession } from "@/lib/auth";
import { formatMoney, type Order } from "@/lib/catalog";
import { Link } from "@/lib/link";
import { PageHeader } from "@/lib/page-header";
import { pgbase } from "@/lib/pgbase";
import { listCustomers } from "@/lib/users";
import { m } from "@/paraglide/messages.js";
import { useAdminStore } from "@/routes/admin/adminLayout";

interface OrderStat {
  count: number;
  spent: number;
  last: string | null;
}

export async function customerListingLoader() {
  const user = await getSession();
  if (user?.role !== "admin") throw redirect("/");

  const [customers, orders] = await Promise.all([
    listCustomers(),
    pgbase
      .from("orders")
      .select("id,customer_id,payment_status,total_cents,placed_at")
      .throwOnError(),
  ]);

  return {
    customers,
    orders: (orders.data ?? []) as Pick<
      Order,
      "id" | "customer_id" | "payment_status" | "total_cents" | "placed_at"
    >[],
  };
}

export function CustomerListing() {
  const { customers, orders } = useLoaderData<Awaited<ReturnType<typeof customerListingLoader>>>();
  const store = useAdminStore();
  const [filter, setFilter] = useState("");

  // Order count / lifetime spend (paid only) / most recent order per customer.
  const stats = useMemo(() => {
    const map = new Map<string, OrderStat>();
    for (const order of orders) {
      if (!order.customer_id) continue;
      const entry = map.get(order.customer_id) ?? { count: 0, spent: 0, last: null };
      entry.count += 1;
      if (order.payment_status === "paid") entry.spent += Number(order.total_cents);
      if (!entry.last || new Date(order.placed_at) > new Date(entry.last)) {
        entry.last = order.placed_at;
      }
      map.set(order.customer_id, entry);
    }
    return map;
  }, [orders]);

  const rows = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const list = term
      ? customers.filter(
          (customer) =>
            customer.name.toLowerCase().includes(term) ||
            customer.email.toLowerCase().includes(term),
        )
      : customers;
    return [...list].sort(
      (a, b) =>
        new Date(stats.get(b.id)?.last ?? 0).getTime() -
        new Date(stats.get(a.id)?.last ?? 0).getTime(),
    );
  }, [customers, filter, stats]);

  const money = (cents: number) =>
    store ? formatMoney(cents, store.currency_code, store.locale) : String(cents);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={m.customers_title()} description={m.customers_description()} />

      <Card>
        <Card.Header className="flex-row flex-wrap items-center justify-between gap-3">
          <SearchField
            aria-label={m.customers_search()}
            variant="secondary"
            value={filter}
            onChange={setFilter}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input className="w-44" placeholder={m.common_search()} />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
        </Card.Header>

        <Card.Content>
          {rows.length === 0 ? (
            <p className="mx-auto max-w-md py-12 text-center text-sm text-muted">
              {customers.length === 0 ? m.customers_empty() : m.customers_no_match()}
            </p>
          ) : (
            <Table>
              <Table.ScrollContainer>
                <Table.Content aria-label="Customers" className="min-w-[760px]">
                  <Table.Header>
                    <Table.Column isRowHeader>{m.common_customer()}</Table.Column>
                    <Table.Column>{m.common_orders()}</Table.Column>
                    <Table.Column>{m.common_spent()}</Table.Column>
                    <Table.Column>{m.common_last_order()}</Table.Column>
                    <Table.Column>{m.common_status()}</Table.Column>
                    <Table.Column>{m.common_joined()}</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {rows.map((customer) => {
                      const stat = stats.get(customer.id);
                      return (
                        <Table.Row key={customer.id} id={customer.id}>
                          <Table.Cell>
                            <Link
                              className="flex flex-col items-start no-underline"
                              href={`/customers/${customer.id}`}
                            >
                              <span className="font-medium text-foreground">{customer.name}</span>
                              <span className="text-xs text-muted">{customer.email}</span>
                            </Link>
                          </Table.Cell>
                          <Table.Cell className="tabular-nums text-muted">
                            {stat?.count ?? 0}
                          </Table.Cell>
                          <Table.Cell className="tabular-nums">
                            {money(stat?.spent ?? 0)}
                          </Table.Cell>
                          <Table.Cell className="text-muted">
                            {stat?.last ? new Date(stat.last).toLocaleDateString() : "—"}
                          </Table.Cell>
                          <Table.Cell>
                            <Chip
                              color={customer.banned ? "danger" : "success"}
                              size="sm"
                              variant="soft"
                            >
                              {customer.banned ? m.common_suspended() : m.common_active()}
                            </Chip>
                          </Table.Cell>
                          <Table.Cell className="text-muted">
                            {new Date(customer.createdAt).toLocaleDateString()}
                          </Table.Cell>
                        </Table.Row>
                      );
                    })}
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
export { CustomerListing as Component, customerListingLoader as loader };
