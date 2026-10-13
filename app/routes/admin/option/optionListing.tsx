import { BarsDescendingAlignLeft, Plus } from "@gravity-ui/icons";
import type { SortDescriptor } from "@heroui/react";
import { Button, Card, Chip, Dropdown, Label, SearchField, Table } from "@heroui/react";
import { useMemo, useState } from "react";
import { useLoaderData, useNavigate } from "react-router";
import type { OptionWithValues, ProductOptionLink } from "@/lib/catalog";
import { Link } from "@/lib/link";
import { PageHeader } from "@/lib/page-header";
import { pgbase } from "@/lib/pgbase";
import { m } from "@/paraglide/messages.js";

export async function optionListingLoader() {
  const [options, links] = await Promise.all([
    pgbase
      .from("options")
      .select("id,name,position,created_at,updated_at,option_values(id,option_id,value,position)")
      .order("position", { ascending: true })
      .throwOnError(),
    pgbase.from("product_options").select("product_id,option_id,position").throwOnError(),
  ]);

  return {
    options: options.data as OptionWithValues[],
    links: links.data as ProductOptionLink[],
  };
}

const SORT_OPTIONS = [
  { id: "updated_at", label: m.sort_last_updated(), direction: "descending" },
  { id: "name", label: m.sort_name_az(), direction: "ascending" },
  { id: "values", label: m.sort_most_values(), direction: "descending" },
  { id: "used_by", label: m.sort_most_used(), direction: "descending" },
] as const;

interface Row {
  id: string;
  name: string;
  updated_at: string;
  values: string[];
  updated: string;
  usedBy: number;
}

function compare(a: Row, b: Row, column: string): number {
  switch (column) {
    case "name":
      return a.name.localeCompare(b.name);
    case "values":
      return a.values.length - b.values.length;
    case "used_by":
      return a.usedBy - b.usedBy;
    default:
      return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
  }
}

export function OptionListing() {
  const { options, links } = useLoaderData<Awaited<ReturnType<typeof optionListingLoader>>>();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("");
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: "updated_at",
    direction: "descending",
  });

  const rows = useMemo<Row[]>(() => {
    const usage = new Map<string, number>();
    for (const link of links) {
      usage.set(link.option_id, (usage.get(link.option_id) ?? 0) + 1);
    }

    const all: Row[] = options.map((option) => ({
      id: option.id,
      name: option.name,
      updated_at: option.updated_at,
      values: [...option.option_values]
        .sort((a, b) => a.position - b.position)
        .map((value) => value.value),
      updated: new Date(option.updated_at).toLocaleDateString(),
      usedBy: usage.get(option.id) ?? 0,
    }));

    const term = filter.trim().toLowerCase();
    const matches = term
      ? all.filter((option) =>
          [option.name, ...option.values].some((value) => value.toLowerCase().includes(term)),
        )
      : all;

    const column = String(sortDescriptor.column);
    const direction = sortDescriptor.direction === "descending" ? -1 : 1;
    return matches.sort((a, b) => compare(a, b, column) * direction);
  }, [options, links, filter, sortDescriptor]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={m.options_title()}
        description={m.options_description()}
        actions={
          <Button size="sm" onPress={() => navigate("/options/new")}>
            <Plus className="size-4" />
            {m.options_new()}
          </Button>
        }
      />

      <Card>
        <Card.Header className="flex-row flex-wrap items-center justify-between gap-3">
          <SearchField
            aria-label={m.options_search()}
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
              {options.length === 0 ? m.options_empty() : m.options_no_match()}
            </p>
          ) : (
            <Table>
              <Table.ScrollContainer>
                <Table.Content
                  aria-label={m.options_title()}
                  className="min-w-[760px]"
                  sortDescriptor={sortDescriptor}
                  onSortChange={setSortDescriptor}
                >
                  <Table.Header>
                    <Table.Column allowsSorting id="name" isRowHeader>
                      {({ sortDirection }) => (
                        <Table.SortableColumnHeader sortDirection={sortDirection}>
                          {m.common_option()}
                        </Table.SortableColumnHeader>
                      )}
                    </Table.Column>
                    <Table.Column allowsSorting id="values">
                      {({ sortDirection }) => (
                        <Table.SortableColumnHeader sortDirection={sortDirection}>
                          {m.common_values()}
                        </Table.SortableColumnHeader>
                      )}
                    </Table.Column>
                    <Table.Column allowsSorting id="used_by">
                      {({ sortDirection }) => (
                        <Table.SortableColumnHeader sortDirection={sortDirection}>
                          {m.common_used_by()}
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
                    {rows.map((option) => (
                      <Table.Row key={option.id} id={option.id}>
                        <Table.Cell>
                          <Link className="font-medium no-underline" href={`/options/${option.id}`}>
                            {option.name}
                          </Link>
                        </Table.Cell>
                        <Table.Cell>
                          {option.values.length === 0 ? (
                            <span className="text-muted">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {option.values.map((value) => (
                                <Chip key={value} size="sm" variant="secondary">
                                  {value}
                                </Chip>
                              ))}
                            </div>
                          )}
                        </Table.Cell>
                        <Table.Cell className="tabular-nums text-muted">{option.usedBy}</Table.Cell>
                        <Table.Cell className="text-muted">{option.updated}</Table.Cell>
                        <Table.Cell className="text-end">
                          <Link
                            className="text-sm font-medium no-underline"
                            href={`/options/${option.id}`}
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
export { OptionListing as Component, optionListingLoader as loader };
