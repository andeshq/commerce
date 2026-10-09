import { useMemo, useState } from "react";
import { Button, Card, Chip, Dropdown, Label, Link, SearchField, Table } from "@heroui/react";
import type { SortDescriptor } from "@heroui/react";
import { BarsDescendingAlignLeft, Plus } from "@gravity-ui/icons";
import { useLoaderData, useNavigate } from "react-router";
import { useAdminStore } from "@/routes/admin/adminLayout";
import { PageHeader } from "@/lib/page-header";
import { pgbase } from "@/lib/pgbase";
import {
  cents,
  formatMoney,
  type ModifierGroupWithValues,
  type ModifierSelection,
  type ProductModifierLink,
} from "@/lib/catalog";

export async function modifierListingLoader() {
  const [modifiers, modifierLinks] = await Promise.all([
    pgbase
      .from("modifier_groups")
      .select(
        "id,name,selection_type,required,position,created_at,updated_at,modifier_values(id,group_id,name,price_delta_cents::text,position)",
      )
      .order("position", { ascending: true })
      .throwOnError(),
    pgbase.from("product_modifier_groups").select("product_id,group_id,position").throwOnError(),
  ]);

  return {
    modifiers: modifiers.data as ModifierGroupWithValues[],
    modifierLinks: modifierLinks.data as ProductModifierLink[],
  };
}

const SORT_OPTIONS = [
  { id: "position", label: "Store order", direction: "ascending" },
  { id: "name", label: "Name A–Z", direction: "ascending" },
  { id: "values", label: "Most values", direction: "descending" },
  { id: "used_by", label: "Most used", direction: "descending" },
] as const;

const TYPE_FILTERS = [
  { id: "all", label: "All types" },
  { id: "single", label: "Single choice" },
  { id: "multiple", label: "Multiple choice" },
] as const;

type TypeFilter = (typeof TYPE_FILTERS)[number]["id"];

interface Row {
  id: string;
  name: string;
  selectionType: ModifierSelection;
  required: boolean;
  values: Array<{ id: string; label: string }>;
  usedBy: number;
  updated_at: string;
  updated: string;
}

function compare(a: Row, b: Row, column: string): number {
  switch (column) {
    case "name":
      return a.name.localeCompare(b.name);
    case "values":
      return a.values.length - b.values.length;
    case "used_by":
      return a.usedBy - b.usedBy;
    case "updated_at":
      return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
    default:
      return 0;
  }
}

export function ModifierListing() {
  const { modifiers, modifierLinks } =
    useLoaderData<Awaited<ReturnType<typeof modifierListingLoader>>>();
  const store = useAdminStore();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: "position",
    direction: "ascending",
  });

  const currency = store?.currency_code ?? "COP";
  const locale = store?.locale ?? "es-CO";

  const rows = useMemo<Row[]>(() => {
    const usage = new Map<string, number>();
    for (const link of modifierLinks) {
      usage.set(link.group_id, (usage.get(link.group_id) ?? 0) + 1);
    }

    const all: Row[] = modifiers.map((group) => ({
      id: group.id,
      name: group.name,
      selectionType: group.selection_type,
      required: group.required,
      values: [...group.modifier_values]
        .sort((a, b) => a.position - b.position)
        .map((value) => {
          const delta = cents(value.price_delta_cents);
          return {
            id: value.id,
            label: delta === 0 ? value.name : `${value.name} +${formatMoney(delta, currency, locale)}`,
          };
        }),
      usedBy: usage.get(group.id) ?? 0,
      updated_at: group.updated_at,
      updated: new Date(group.updated_at).toLocaleDateString(),
    }));

    const term = filter.trim().toLowerCase();
    const matches = all.filter((row) => {
      if (type !== "all" && row.selectionType !== type) return false;
      if (!term) return true;
      return (
        row.name.toLowerCase().includes(term) ||
        row.values.some((value) => value.label.toLowerCase().includes(term))
      );
    });

    const column = String(sortDescriptor.column);
    const direction = sortDescriptor.direction === "descending" ? -1 : 1;
    if (column === "position") return matches;
    return matches.sort((a, b) => compare(a, b, column) * direction);
  }, [modifiers, modifierLinks, filter, type, sortDescriptor, currency, locale]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Modifiers"
        description="Priced add-ons customers can pick at checkout."
        actions={
          <Button size="sm" onPress={() => navigate("/admin/modifiers/new")}>
            <Plus className="size-4" />
            New modifier
          </Button>
        }
      />

      <Card>
        <Card.Header className="flex-row flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <SearchField
              aria-label="Search modifiers"
              variant="secondary"
              value={filter}
              onChange={setFilter}
            >
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input className="w-44" placeholder="Search" />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>

            <Dropdown>
              <Button size="sm" variant="secondary">
                Type: {TYPE_FILTERS.find((item) => item.id === type)?.label ?? "All types"}
              </Button>
              <Dropdown.Popover>
                <Dropdown.Menu
                  selectedKeys={[type]}
                  selectionMode="single"
                  onSelectionChange={(keys) => {
                    const [key] = [...keys];
                    if (typeof key === "string") setType(key as TypeFilter);
                  }}
                >
                  {TYPE_FILTERS.map((option) => (
                    <Dropdown.Item key={option.id} id={option.id} textValue={option.label}>
                      <Label>{option.label}</Label>
                      <Dropdown.ItemIndicator />
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>

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
              {modifiers.length === 0
                ? "No modifiers yet. Create your first one."
                : "No modifiers match your filters."}
            </p>
          ) : (
            <Table>
              <Table.ScrollContainer>
                <Table.Content
                  aria-label="Modifiers"
                  className="min-w-[860px]"
                  sortDescriptor={sortDescriptor}
                  onSortChange={setSortDescriptor}
                >
                  <Table.Header>
                    <Table.Column allowsSorting id="name" isRowHeader>
                      {({ sortDirection }) => (
                        <Table.SortableColumnHeader sortDirection={sortDirection}>
                          Modifier
                        </Table.SortableColumnHeader>
                      )}
                    </Table.Column>
                    <Table.Column id="type">Type</Table.Column>
                    <Table.Column allowsSorting id="values">
                      {({ sortDirection }) => (
                        <Table.SortableColumnHeader sortDirection={sortDirection}>
                          Values
                        </Table.SortableColumnHeader>
                      )}
                    </Table.Column>
                    <Table.Column allowsSorting id="used_by">
                      {({ sortDirection }) => (
                        <Table.SortableColumnHeader sortDirection={sortDirection}>
                          Used by
                        </Table.SortableColumnHeader>
                      )}
                    </Table.Column>
                    <Table.Column allowsSorting id="updated_at">
                      {({ sortDirection }) => (
                        <Table.SortableColumnHeader sortDirection={sortDirection}>
                          Updated
                        </Table.SortableColumnHeader>
                      )}
                    </Table.Column>
                    <Table.Column className="text-end">Actions</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {rows.map((row) => (
                      <Table.Row key={row.id} id={row.id}>
                        <Table.Cell>
                          <Link
                            className="flex flex-col no-underline"
                            href={`/admin/modifiers/${row.id}`}
                          >
                            <span className="font-medium text-foreground">{row.name}</span>
                            {row.required && (
                              <span className="text-xs text-muted">Required</span>
                            )}
                          </Link>
                        </Table.Cell>
                        <Table.Cell>
                          <Chip size="sm" variant="soft">
                            {row.selectionType === "single" ? "Single" : "Multiple"}
                          </Chip>
                        </Table.Cell>
                        <Table.Cell>
                          {row.values.length === 0 ? (
                            <span className="text-muted">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {row.values.map((value) => (
                                <Chip key={value.id} size="sm" variant="secondary">
                                  {value.label}
                                </Chip>
                              ))}
                            </div>
                          )}
                        </Table.Cell>
                        <Table.Cell className="tabular-nums text-muted">{row.usedBy}</Table.Cell>
                        <Table.Cell className="text-muted">{row.updated}</Table.Cell>
                        <Table.Cell className="text-end">
                          <Link
                            className="text-sm font-medium no-underline"
                            href={`/admin/modifiers/${row.id}`}
                          >
                            Edit
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
export { ModifierListing as Component, modifierListingLoader as loader };
