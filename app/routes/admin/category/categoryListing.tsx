import { useMemo, useState } from "react";
import { Button, Card, Dropdown, Label, Link, SearchField, Table } from "@heroui/react";
import type { SortDescriptor } from "@heroui/react";
import { BarsDescendingAlignLeft, ChevronRight, Plus } from "@gravity-ui/icons";
import { useLoaderData, useNavigate } from "react-router";
import { PageHeader } from "@/lib/page-header";
import { pgbase } from "@/lib/pgbase";
import { categoryTree, type Category, type Product } from "@/lib/catalog";

export async function categoryListingLoader() {
  const [categories, products] = await Promise.all([
    pgbase
      .from("categories")
      .select("id,parent_id,name,slug,description,position,created_at,updated_at")
      .order("position", { ascending: true })
      .throwOnError(),
    pgbase.from("products").select("id,category_id").throwOnError(),
  ]);

  return {
    categories: categories.data as Category[],
    products: products.data as Product[],
  };
}

const SORT_OPTIONS = [
  { id: "position", label: "Store order", direction: "ascending" },
  { id: "name", label: "Name A–Z", direction: "ascending" },
  { id: "products", label: "Most products", direction: "descending" },
  { id: "updated_at", label: "Last updated", direction: "descending" },
] as const;

interface Row {
  id: string;
  name: string;
  slug: string;
  depth: number;
  childCount: number;
  productCount: number;
  updated_at: string;
  updated: string;
}

export function CategoryListing() {
  const { categories, products } =
    useLoaderData<Awaited<ReturnType<typeof categoryListingLoader>>>();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: "position",
    direction: "ascending",
  });

  const rows = useMemo<Row[]>(() => {
    const productCounts = new Map<string, number>();
    for (const product of products) {
      if (!product.category_id) continue;
      productCounts.set(product.category_id, (productCounts.get(product.category_id) ?? 0) + 1);
    }

    const childCounts = new Map<string, number>();
    for (const category of categories) {
      if (!category.parent_id) continue;
      childCounts.set(category.parent_id, (childCounts.get(category.parent_id) ?? 0) + 1);
    }

    const column = String(sortDescriptor.column);
    const direction = sortDescriptor.direction === "descending" ? -1 : 1;
    const compare = (a: Category, b: Category) => {
      switch (column) {
        case "name":
          return a.name.localeCompare(b.name) * direction;
        case "products":
          return ((productCounts.get(a.id) ?? 0) - (productCounts.get(b.id) ?? 0)) * direction;
        case "updated_at":
          return (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()) * direction;
        default:
          return (a.position - b.position || a.name.localeCompare(b.name)) * 1;
      }
    };

    const tree = categoryTree(categories, compare).map(({ category, depth }) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      depth,
      childCount: childCounts.get(category.id) ?? 0,
      productCount: productCounts.get(category.id) ?? 0,
      updated_at: category.updated_at,
      updated: new Date(category.updated_at).toLocaleDateString(),
    }));

    const term = filter.trim().toLowerCase();
    if (term) {
      return tree.filter(
        (row) =>
          row.name.toLowerCase().includes(term) || row.slug.toLowerCase().includes(term),
      );
    }

    // Hide descendants of collapsed rows; `hideDepths` tracks collapsed ancestors.
    const collapsedIds = new Set(collapsed);
    const visible: Row[] = [];
    const hideDepths: number[] = [];
    for (const row of tree) {
      while (hideDepths.length > 0 && row.depth <= hideDepths[hideDepths.length - 1]) {
        hideDepths.pop();
      }
      if (hideDepths.length > 0) continue;

      visible.push(row);
      if (collapsedIds.has(row.id)) hideDepths.push(row.depth);
    }

    return visible;
  }, [categories, products, filter, collapsed, sortDescriptor]);

  function toggleCollapsed(categoryId: string) {
    setCollapsed((current) =>
      current.includes(categoryId)
        ? current.filter((id) => id !== categoryId)
        : [...current, categoryId],
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Categories"
        description="Group products for your storefront and reports."
        actions={
          <Button size="sm" onPress={() => navigate("/admin/categories/new")}>
            <Plus className="size-4" />
            New category
          </Button>
        }
      />

      <Card>
        <Card.Header className="flex-row flex-wrap items-center justify-between gap-3">
          <SearchField
            aria-label="Search categories"
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
              {categories.length === 0
                ? "No categories yet. Create your first one."
                : "No categories match your search."}
            </p>
          ) : (
            <Table>
              <Table.ScrollContainer>
                <Table.Content
                  aria-label="Categories"
                  className="min-w-[680px]"
                  sortDescriptor={sortDescriptor}
                  onSortChange={setSortDescriptor}
                >
                  <Table.Header>
                    <Table.Column allowsSorting id="name" isRowHeader>
                      {({ sortDirection }) => (
                        <Table.SortableColumnHeader sortDirection={sortDirection}>
                          Category
                        </Table.SortableColumnHeader>
                      )}
                    </Table.Column>
                    <Table.Column allowsSorting id="products">
                      {({ sortDirection }) => (
                        <Table.SortableColumnHeader sortDirection={sortDirection}>
                          Products
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
                    {rows.map((row) => {
                      const isCollapsed = collapsed.includes(row.id);
                      return (
                        <Table.Row key={row.id} id={row.id}>
                          <Table.Cell>
                            <div
                              className="flex items-center gap-2"
                              style={{ paddingLeft: row.depth * 20 }}
                            >
                              {row.childCount > 0 ? (
                                <Button
                                  aria-label={
                                    isCollapsed
                                      ? `Expand ${row.name}`
                                      : `Collapse ${row.name}`
                                  }
                                  aria-expanded={!isCollapsed}
                                  isIconOnly
                                  size="sm"
                                  variant="tertiary"
                                  onPress={() => toggleCollapsed(row.id)}
                                >
                                  <ChevronRight
                                    className={
                                      isCollapsed
                                        ? "size-4 transition-transform"
                                        : "size-4 rotate-90 transition-transform"
                                    }
                                  />
                                </Button>
                              ) : (
                                <span className="w-8" aria-hidden />
                              )}
                              <Link
                                className="flex flex-col no-underline"
                                href={`/admin/categories/${row.id}`}
                              >
                                <span className="font-medium text-foreground">{row.name}</span>
                                <span className="text-xs text-muted">{row.slug}</span>
                              </Link>
                            </div>
                          </Table.Cell>
                          <Table.Cell className="tabular-nums text-muted">
                            {row.productCount}
                          </Table.Cell>
                          <Table.Cell className="text-muted">{row.updated}</Table.Cell>
                          <Table.Cell className="text-end">
                            <Link
                              className="text-sm font-medium no-underline"
                              href={`/admin/categories/${row.id}`}
                            >
                              Edit
                            </Link>
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
export { CategoryListing as Component, categoryListingLoader as loader };
