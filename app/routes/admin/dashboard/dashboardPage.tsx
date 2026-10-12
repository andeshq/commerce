import { useMemo, useState } from "react";
import { Button, Card, Chip, Dropdown, Label, ProgressBar, SearchField, Table } from "@heroui/react";
import { Link } from "@/lib/link";
import type { SortDescriptor } from "@heroui/react";
import {
  Archive,
  BarsDescendingAlignLeft,
  Boxes3,
  CircleCheck,
  Pencil,
} from "@gravity-ui/icons";
import { useLoaderData } from "react-router";
import { PageHeader } from "@/lib/page-header";
import { pgbase } from "@/lib/pgbase";
import { productStatusLabel } from "@/lib/i18n";
import { useAdminStore } from "@/routes/admin/adminLayout";
import { m } from "@/paraglide/messages.js";
import { formatMoney, type Order, type Product, type ProductStatus } from "@/lib/catalog";

const STATUS_COLOR: Record<ProductStatus, "success" | "warning" | "default"> = {
  active: "success",
  draft: "warning",
  archived: "default",
};

const SORT_OPTIONS = [
  { id: "updated_at", label: m.sort_last_updated(), direction: "descending" },
  { id: "title", label: m.sort_title_az(), direction: "ascending" },
  { id: "status", label: m.common_status(), direction: "ascending" },
  { id: "vendor", label: m.sort_vendor_az(), direction: "ascending" },
] as const;

function compare(a: Product, b: Product, column: string): number {
  switch (column) {
    case "title":
      return a.title.localeCompare(b.title);
    case "status":
      return a.status.localeCompare(b.status);
    case "vendor":
      return (a.vendor ?? "").localeCompare(b.vendor ?? "");
    default:
      return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
  }
}

export async function dashboardLoader() {
  const [products, orders] = await Promise.all([
    pgbase
      .from("products")
      .select("id,title,slug,status,vendor,product_type,category_id,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .throwOnError(),
    pgbase
      .from("orders")
      .select("id,total_cents,status,payment_status,fulfillment_status,placed_at")
      .order("placed_at", { ascending: false })
      .throwOnError(),
  ]);

  return { products: products.data as Product[], orders: orders.data as Order[] };
}

export function DashboardPage() {
  const { products, orders } = useLoaderData<Awaited<ReturnType<typeof dashboardLoader>>>();
  const store = useAdminStore();
  const [filter, setFilter] = useState("");
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: "updated_at",
    direction: "descending",
  });

  const counts = useMemo(() => {
    const by = (status: ProductStatus) =>
      products.filter((product) => product.status === status).length;
    return {
      total: products.length,
      active: by("active"),
      draft: by("draft"),
      archived: by("archived"),
    };
  }, [products]);

  const sales = useMemo(() => {
    const revenue = orders
      .filter((order) => order.status !== "cancelled" && order.payment_status === "paid")
      .reduce((total, order) => total + Number(order.total_cents), 0);
    const toFulfill = orders.filter(
      (order) => order.status !== "cancelled" && order.fulfillment_status !== "fulfilled",
    ).length;
    return { count: orders.length, revenue, toFulfill };
  }, [orders]);

  const recent = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const matches = term
      ? products.filter((product) =>
          [product.title, product.slug, product.vendor ?? ""].some((value) =>
            value.toLowerCase().includes(term),
          ),
        )
      : products;

    const column = String(sortDescriptor.column);
    const direction = sortDescriptor.direction === "descending" ? -1 : 1;

    return [...matches]
      .sort((a, b) => compare(a, b, column) * direction)
      .slice(0, 6)
      .map((product) => ({
        ...product,
        updated: new Date(product.updated_at).toLocaleDateString(),
      }));
  }, [products, filter, sortDescriptor]);

  const share = (value: number) =>
    counts.total === 0 ? 0 : Math.round((value / counts.total) * 100);

  const stats = [
    {
      label: m.dashboard_stat_products(),
      value: counts.total,
      icon: Boxes3,
      footer: m.dashboard_footer_published({ percent: share(counts.active) }),
    },
    {
      label: m.dashboard_stat_active(),
      value: counts.active,
      icon: CircleCheck,
      footer: m.dashboard_footer_active(),
    },
    {
      label: m.dashboard_stat_drafts(),
      value: counts.draft,
      icon: Pencil,
      footer: m.dashboard_footer_drafts(),
    },
    {
      label: m.dashboard_stat_archived(),
      value: counts.archived,
      icon: Archive,
      footer: m.dashboard_footer_archived(),
    },
  ];

  const breakdown = [
    { label: m.status_active(), value: counts.active, color: "success" as const },
    { label: m.status_draft(), value: counts.draft, color: "warning" as const },
    { label: m.status_archived(), value: counts.archived, color: "default" as const },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={m.dashboard_title()} description={m.dashboard_description()} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, footer }) => (
          <Card key={label}>
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm text-muted">{label}</span>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-muted">
                <Icon className="size-4" />
              </span>
            </div>
            <span className="text-3xl font-semibold tabular-nums">{value}</span>
            <span className="text-xs text-muted">{footer}</span>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <span className="text-sm text-muted">{m.common_orders()}</span>
          <span className="text-3xl font-semibold tabular-nums">{sales.count}</span>
          <span className="text-xs text-muted">{m.dashboard_all_time()}</span>
        </Card>
        <Card>
          <span className="text-sm text-muted">{m.dashboard_revenue()}</span>
          <span className="text-3xl font-semibold tabular-nums">
            {store ? formatMoney(sales.revenue, store.currency_code, store.locale) : sales.revenue}
          </span>
          <span className="text-xs text-muted">{m.dashboard_paid_orders()}</span>
        </Card>
        <Card>
          <span className="text-sm text-muted">{m.dashboard_to_fulfill()}</span>
          <span className="text-3xl font-semibold tabular-nums">{sales.toFulfill}</span>
          <span className="text-xs text-muted">{m.dashboard_awaiting_fulfillment()}</span>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <Card.Header className="flex-row flex-wrap items-center justify-between gap-3">
            <Card.Title>{m.dashboard_recent_products()}</Card.Title>
            <div className="flex flex-wrap items-center gap-2">
              <SearchField
                aria-label={m.dashboard_filter_products()}
                variant="secondary"
                value={filter}
                onChange={setFilter}
              >
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input className="w-40" placeholder={m.dashboard_filter_placeholder()} />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>

              <Dropdown>
                <Button size="sm" variant="secondary">
                  <BarsDescendingAlignLeft className="size-4" />
                  {m.common_sort_by()}
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
            {recent.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">
                {products.length === 0 ? m.dashboard_no_products() : m.dashboard_no_match()}
              </p>
            ) : (
              <Table>
                <Table.ScrollContainer>
                  <Table.Content
                    aria-label={m.dashboard_recent_products()}
                    className="min-w-[640px]"
                    sortDescriptor={sortDescriptor}
                    onSortChange={setSortDescriptor}
                  >
                    <Table.Header>
                      <Table.Column allowsSorting id="title" isRowHeader>
                        {({ sortDirection }) => (
                          <Table.SortableColumnHeader sortDirection={sortDirection}>
                            {m.common_product()}
                          </Table.SortableColumnHeader>
                        )}
                      </Table.Column>
                      <Table.Column allowsSorting id="status">
                        {({ sortDirection }) => (
                          <Table.SortableColumnHeader sortDirection={sortDirection}>
                            {m.common_status()}
                          </Table.SortableColumnHeader>
                        )}
                      </Table.Column>
                      <Table.Column allowsSorting id="vendor">
                        {({ sortDirection }) => (
                          <Table.SortableColumnHeader sortDirection={sortDirection}>
                            {m.common_vendor()}
                          </Table.SortableColumnHeader>
                        )}
                      </Table.Column>
                      <Table.Column allowsSorting id="updated_at">
                        {({ sortDirection }) => (
                          <Table.SortableColumnHeader sortDirection={sortDirection}>
                            {m.common_updated()}
                          </Table.SortableColumnHeader>
                        )}
                      </Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {recent.map((product) => (
                        <Table.Row key={product.id} id={product.id}>
                          <Table.Cell>
                            <Link
                              className="font-medium no-underline"
                              href={`/products/${product.id}`}
                            >
                              {product.title}
                            </Link>
                          </Table.Cell>
                          <Table.Cell>
                            <Chip color={STATUS_COLOR[product.status]} size="sm" variant="soft">
                              {productStatusLabel(product.status)}
                            </Chip>
                          </Table.Cell>
                          <Table.Cell>{product.vendor ?? "—"}</Table.Cell>
                          <Table.Cell className="text-muted">{product.updated}</Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
            )}
          </Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>{m.dashboard_catalog_status()}</Card.Title>
            <Card.Description>{m.dashboard_catalog_description()}</Card.Description>
          </Card.Header>
          <Card.Content className="gap-4">
            {breakdown.map(({ label, value, color }) => (
              <ProgressBar key={label} aria-label={label} color={color} value={share(value)}>
                <div className="flex items-center justify-between text-sm">
                  <Label>{label}</Label>
                  <span className="text-muted tabular-nums">{value}</span>
                </div>
                <ProgressBar.Track>
                  <ProgressBar.Fill />
                </ProgressBar.Track>
              </ProgressBar>
            ))}
          </Card.Content>
        </Card>
      </div>
    </div>
  );
}

/* React Router lazy-route contract. */
export { DashboardPage as Component, dashboardLoader as loader };
