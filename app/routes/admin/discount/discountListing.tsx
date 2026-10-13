import { BarsDescendingAlignLeft, Plus } from "@gravity-ui/icons";
import type { SortDescriptor } from "@heroui/react";
import { Button, Card, Dropdown, Label, SearchField, Table } from "@heroui/react";
import { useMemo, useState } from "react";
import { useLoaderData, useNavigate } from "react-router";
import { formatMoney } from "@/lib/catalog";
import { Link } from "@/lib/link";
import { PageHeader } from "@/lib/page-header";
import { pgbase } from "@/lib/pgbase";
import { m } from "@/paraglide/messages.js";
import { useAdminStore } from "@/routes/admin/adminLayout";

export interface DiscountRow {
  id: string;
  code: string;
  type: "percentage" | "fixed";
  value: number;
  usage_limit: number | null;
  times_used: number;
  active: boolean;
  updated_at: string;
}

export async function discountListingLoader() {
  const discounts = await pgbase
    .from("discounts")
    .select("id,code,type,value,usage_limit,times_used,active,updated_at")
    .throwOnError();
  return { discounts: discounts.data as DiscountRow[] };
}

const SORT_OPTIONS = [
  { id: "code", label: m.discounts_sort_code(), direction: "ascending" },
  { id: "usage", label: m.discounts_sort_usage(), direction: "descending" },
  { id: "updated_at", label: m.discounts_sort_updated(), direction: "descending" },
] as const;

export function DiscountListing() {
  const { discounts } = useLoaderData<Awaited<ReturnType<typeof discountListingLoader>>>();
  const store = useAdminStore();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("");
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: "updated_at",
    direction: "descending",
  });

  const currency = store?.currency_code ?? "USD";
  const locale = store?.locale ?? "en";

  const rows = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const filtered = term
      ? discounts.filter((row) => row.code.toLowerCase().includes(term))
      : discounts;

    const column = String(sortDescriptor.column);
    const direction = sortDescriptor.direction === "descending" ? -1 : 1;
    return [...filtered].sort((a, b) => {
      switch (column) {
        case "code":
          return a.code.localeCompare(b.code) * direction;
        case "usage":
          return (a.times_used - b.times_used) * direction;
        default:
          return (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()) * direction;
      }
    });
  }, [discounts, filter, sortDescriptor]);

  function amount(row: DiscountRow): string {
    return row.type === "percentage"
      ? `${row.value / 100}%`
      : formatMoney(row.value, currency, locale);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={m.discounts_title()}
        description={m.discounts_description()}
        actions={
          <Button size="sm" onPress={() => navigate("/discounts/new")}>
            <Plus className="size-4" />
            {m.discounts_new()}
          </Button>
        }
      />

      <Card>
        <Card.Header className="flex-row flex-wrap items-center justify-between gap-3">
          <SearchField
            aria-label={m.discounts_search()}
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
                    setSortDescriptor({ column: option.id, direction: option.direction });
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
        </Card.Header>

        <Card.Content>
          {rows.length === 0 ? (
            <p className="mx-auto max-w-md py-12 text-center text-sm text-muted">
              {discounts.length === 0 ? m.discounts_empty() : m.discounts_no_match()}
            </p>
          ) : (
            <Table>
              <Table.ScrollContainer>
                <Table.Content
                  aria-label={m.discounts_title()}
                  className="min-w-[680px]"
                  sortDescriptor={sortDescriptor}
                  onSortChange={setSortDescriptor}
                >
                  <Table.Header>
                    <Table.Column allowsSorting id="code" isRowHeader>
                      {({ sortDirection }) => (
                        <Table.SortableColumnHeader sortDirection={sortDirection}>
                          {m.discounts_code()}
                        </Table.SortableColumnHeader>
                      )}
                    </Table.Column>
                    <Table.Column>{m.discounts_value()}</Table.Column>
                    <Table.Column allowsSorting id="usage">
                      {({ sortDirection }) => (
                        <Table.SortableColumnHeader sortDirection={sortDirection}>
                          {m.discounts_times_used()}
                        </Table.SortableColumnHeader>
                      )}
                    </Table.Column>
                    <Table.Column>{m.common_status()}</Table.Column>
                    <Table.Column allowsSorting id="updated_at">
                      {({ sortDirection }) => (
                        <Table.SortableColumnHeader sortDirection={sortDirection}>
                          {m.common_updated()}
                        </Table.SortableColumnHeader>
                      )}
                    </Table.Column>
                    <Table.Column className="text-end">{m.common_actions()}</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {rows.map((row) => (
                      <Table.Row key={row.id} id={row.id}>
                        <Table.Cell>
                          <Link
                            className="font-medium text-foreground no-underline"
                            href={`/discounts/${row.id}`}
                          >
                            {row.code}
                          </Link>
                        </Table.Cell>
                        <Table.Cell className="tabular-nums text-muted">{amount(row)}</Table.Cell>
                        <Table.Cell className="tabular-nums text-muted">
                          {row.usage_limit === null
                            ? m.discounts_usage_unlimited({ used: row.times_used })
                            : m.discounts_usage({
                                used: row.times_used,
                                limit: row.usage_limit,
                              })}
                        </Table.Cell>
                        <Table.Cell className="text-muted">
                          {row.active ? m.common_active() : m.common_inactive()}
                        </Table.Cell>
                        <Table.Cell className="text-muted">
                          {new Date(row.updated_at).toLocaleDateString()}
                        </Table.Cell>
                        <Table.Cell className="text-end">
                          <Link
                            className="text-sm font-medium no-underline"
                            href={`/discounts/${row.id}`}
                          >
                            {m.common_edit()}
                          </Link>
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
export { DiscountListing as Component, discountListingLoader as loader };
