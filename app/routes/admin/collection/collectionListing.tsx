import { BarsDescendingAlignLeft, Plus } from "@gravity-ui/icons";
import type { SortDescriptor } from "@heroui/react";
import { Button, Card, Dropdown, Label, SearchField, Table } from "@heroui/react";
import { useMemo, useState } from "react";
import { useLoaderData, useNavigate } from "react-router";
import type { Collection } from "@/lib/catalog";
import { Link } from "@/lib/link";
import { PageHeader } from "@/lib/page-header";
import { pgbase } from "@/lib/pgbase";
import { m } from "@/paraglide/messages.js";

export async function collectionListingLoader() {
  const [collections, links] = await Promise.all([
    pgbase
      .from("collections")
      .select("id,name,slug,description,type,position,created_at,updated_at")
      .order("position", { ascending: true })
      .throwOnError(),
    pgbase.from("product_collections").select("collection_id").throwOnError(),
  ]);

  const counts = new Map<string, number>();
  for (const link of (links.data ?? []) as Array<{ collection_id: string }>) {
    counts.set(link.collection_id, (counts.get(link.collection_id) ?? 0) + 1);
  }

  return { collections: collections.data as Collection[], counts: Object.fromEntries(counts) };
}

const SORT_OPTIONS = [
  { id: "position", label: m.collections_sort_position(), direction: "ascending" },
  { id: "name", label: m.collections_sort_name(), direction: "ascending" },
  { id: "products", label: m.collections_sort_products(), direction: "descending" },
  { id: "updated_at", label: m.collections_sort_updated(), direction: "descending" },
] as const;

export function CollectionListing() {
  const { collections, counts } =
    useLoaderData<Awaited<ReturnType<typeof collectionListingLoader>>>();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("");
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: "position",
    direction: "ascending",
  });

  const rows = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const filtered = term
      ? collections.filter(
          (row) => row.name.toLowerCase().includes(term) || row.slug.toLowerCase().includes(term),
        )
      : collections;

    const column = String(sortDescriptor.column);
    const direction = sortDescriptor.direction === "descending" ? -1 : 1;
    return [...filtered].sort((a, b) => {
      switch (column) {
        case "name":
          return a.name.localeCompare(b.name) * direction;
        case "products":
          return ((counts[a.id] ?? 0) - (counts[b.id] ?? 0)) * direction;
        case "updated_at":
          return (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()) * direction;
        default:
          return (a.position - b.position || a.name.localeCompare(b.name)) * direction;
      }
    });
  }, [collections, counts, filter, sortDescriptor]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={m.collections_title()}
        description={m.collections_description()}
        actions={
          <Button size="sm" onPress={() => navigate("/collections/new")}>
            <Plus className="size-4" />
            {m.collections_new()}
          </Button>
        }
      />

      <Card>
        <Card.Header className="flex-row flex-wrap items-center justify-between gap-3">
          <SearchField
            aria-label={m.collections_search()}
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
              {collections.length === 0 ? m.collections_empty() : m.collections_no_match()}
            </p>
          ) : (
            <Table>
              <Table.ScrollContainer>
                <Table.Content
                  aria-label={m.collections_title()}
                  className="min-w-[680px]"
                  sortDescriptor={sortDescriptor}
                  onSortChange={setSortDescriptor}
                >
                  <Table.Header>
                    <Table.Column allowsSorting id="name" isRowHeader>
                      {({ sortDirection }) => (
                        <Table.SortableColumnHeader sortDirection={sortDirection}>
                          {m.common_name()}
                        </Table.SortableColumnHeader>
                      )}
                    </Table.Column>
                    <Table.Column allowsSorting id="products">
                      {({ sortDirection }) => (
                        <Table.SortableColumnHeader sortDirection={sortDirection}>
                          {m.common_products()}
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
                    <Table.Column className="text-end">{m.common_actions()}</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {rows.map((row) => (
                      <Table.Row key={row.id} id={row.id}>
                        <Table.Cell>
                          <Link
                            className="flex flex-col items-start no-underline"
                            href={`/collections/${row.id}`}
                          >
                            <span className="font-medium text-foreground">{row.name}</span>
                            <span className="text-xs text-muted">{row.slug}</span>
                          </Link>
                        </Table.Cell>
                        <Table.Cell className="tabular-nums text-muted">
                          {counts[row.id] ?? 0}
                        </Table.Cell>
                        <Table.Cell className="text-muted">
                          {new Date(row.updated_at).toLocaleDateString()}
                        </Table.Cell>
                        <Table.Cell className="text-end">
                          <Link
                            className="text-sm font-medium no-underline"
                            href={`/collections/${row.id}`}
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
export { CollectionListing as Component, collectionListingLoader as loader };
