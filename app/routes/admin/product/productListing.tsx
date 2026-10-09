import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  Chip,
  Dropdown,
  Label,
  Link,
  SearchField,
  Table,
} from "@heroui/react";
import type { SortDescriptor } from "@heroui/react";
import {
  ArrowDownToLine,
  BarsDescendingAlignLeft,
  ChevronDown,
  ChevronRight,
  Picture,
  Plus,
} from "@gravity-ui/icons";
import {
  useFetcher,
  useLoaderData,
  useNavigate,
  useSearchParams,
  type ActionFunctionArgs,
} from "react-router";
import { useAdminStore } from "@/routes/admin/adminLayout";
import { PageHeader } from "@/lib/page-header";
import {
  categoryDescendantIds,
  categoryPath,
  categoryTree,
  cents,
  formatMoney,
  priceRange,
  PRODUCT_STATUSES,
  type Category,
  type InventoryLevel,
  type Media,
  type ProductMediaLink,
  type ProductStatus,
  type ProductVariantCost,
  type Product,
  type Variant,
} from "@/lib/catalog";
import { pgbase, pgbaseErrorMessages } from "@/lib/pgbase";
import { totalStockByVariant } from "@/lib/inventory";

/** Everything the listing renders: catalog, stock, and media thumbnails. */
export async function productListingLoader() {
  const [products, variants, inventory, categories, media, productMedia, costs] =
    await Promise.all([
      pgbase
        .from("products")
        .select("id,title,slug,status,vendor,product_type,category_id,created_at,updated_at")
        .order("updated_at", { ascending: false })
        .throwOnError(),
      pgbase
        .from("catalog_variants")
        .select("id,product_id,title,sku,barcode,position,price_cents,compare_at_price_cents")
        .order("position", { ascending: true })
        .throwOnError(),
      pgbase.from("inventory_levels").select("variant_id,location_id,available,updated_at").throwOnError(),
      pgbase
        .from("categories")
        .select("id,parent_id,name,slug,description,position,created_at,updated_at")
        .order("position", { ascending: true })
        .throwOnError(),
      pgbase.from("media").select("id,url,alt,width,height").throwOnError(),
      pgbase
        .from("product_media")
        .select("product_id,media_id,position")
        .order("position", { ascending: true })
        .throwOnError(),
      pgbase.from("product_variant_costs").select("variant_id,cost_cents::text").throwOnError(),
    ]);

  return {
    products: products.data as Product[],
    variants: variants.data as Variant[],
    inventory: inventory.data as InventoryLevel[],
    categories: categories.data as Category[],
    media: media.data as Media[],
    productMedia: productMedia.data as ProductMediaLink[],
    costs: costs.data as ProductVariantCost[],
  };
}

/** Bulk status changes: one PATCH, then the route revalidates itself. */
export async function productListingAction({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "set-status") {
    const status = String(formData.get("status")) as ProductStatus;
    const ids = JSON.parse(String(formData.get("ids"))) as string[];

    if (!PRODUCT_STATUSES.includes(status) || ids.length === 0) {
      return { ok: false, errors: ["Select at least one product."] };
    }

    try {
      await pgbase.from("products").update({ status }).in("id", ids).throwOnError();
      return { ok: true, errors: [] as string[] };
    } catch (error) {
      return { ok: false, errors: pgbaseErrorMessages(error) };
    }
  }

  return { ok: false, errors: ["Unknown action."] };
}

const STATUS_COLOR: Record<ProductStatus, "success" | "warning" | "default"> = {
  active: "success",
  draft: "warning",
  archived: "default",
};

const SORT_OPTIONS = [
  { id: "updated_at", label: "Last updated", direction: "descending" },
  { id: "title", label: "Title A–Z", direction: "ascending" },
  { id: "status", label: "Status", direction: "ascending" },
  { id: "price", label: "Price", direction: "ascending" },
  { id: "stock", label: "Stock", direction: "descending" },
] as const;

const STATUS_FILTERS = [
  { id: "all", label: "All statuses" },
  { id: "active", label: "Active" },
  { id: "draft", label: "Draft" },
  { id: "archived", label: "Archived" },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]["id"];

interface Row extends Product {
  updated: string;
  prices: number[];
  priceLabel: string;
  variantCount: number;
  stock: number | null;
  category: string | null;
}

interface VariantRow {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  priceLabel: string;
  price: number;
  compareAt: number | null;
  cost: number | null;
  stock: number | undefined;
}

function compare(a: Row, b: Row, column: string): number {
  switch (column) {
    case "title":
      return a.title.localeCompare(b.title);
    case "status":
      return a.status.localeCompare(b.status);
    case "price":
      return (a.prices[0] ?? 0) - (b.prices[0] ?? 0);
    case "stock":
      return (a.stock ?? 0) - (b.stock ?? 0);
    default:
      return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
  }
}

export function ProductListing() {
  const { products, variants, inventory, categories, media, productMedia, costs } =
    useLoaderData<Awaited<ReturnType<typeof productListingLoader>>>();
  const store = useAdminStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";

  const [filter, setFilter] = useState(query);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [category, setCategory] = useState("all");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const bulkFetcher = useFetcher<typeof productListingAction>();
  const bulkBusy = bulkFetcher.state !== "idle";
  const bulkError = bulkFetcher.data?.errors?.[0] ?? null;
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: "updated_at",
    direction: "descending",
  });

  const currency = store?.currency_code ?? "COP";
  const locale = store?.locale ?? "es-CO";

  // Keep the local filter in sync when the shell search updates ?q.
  useEffect(() => {
    setFilter(query);
  }, [query]);

  const variantRows = useMemo(() => {
    const stockByVariant = totalStockByVariant(inventory);
    const costByVariant = new Map(costs.map((cost) => [cost.variant_id, cents(cost.cost_cents)]));
    const byProduct = new Map<string, VariantRow[]>();

    for (const variant of variants) {
      const rows = byProduct.get(variant.product_id) ?? [];
      rows.push({
        id: variant.id,
        title: variant.title,
        sku: variant.sku,
        barcode: variant.barcode,
        priceLabel: formatMoney(variant.price_cents, currency, locale),
        price: cents(variant.price_cents),
        compareAt:
          variant.compare_at_price_cents === null
            ? null
            : cents(variant.compare_at_price_cents),
        cost: costByVariant.get(variant.id) ?? null,
        stock: stockByVariant.get(variant.id),
      });
      byProduct.set(variant.product_id, rows);
    }

    return byProduct;
  }, [variants, inventory, costs, currency, locale]);

  const imageByProduct = useMemo(() => {
    const mediaById = new Map(media.map((item) => [item.id, item]));
    const byProduct = new Map<string, string>();
    for (const link of productMedia) {
      if (byProduct.has(link.product_id)) continue;
      const item = mediaById.get(link.media_id);
      if (item) byProduct.set(link.product_id, item.url);
    }
    return byProduct;
  }, [media, productMedia]);

  const rows = useMemo<Row[]>(() => {
    const byProduct = new Map<string, Row>();
    const categoryById = new Map(categories.map((item) => [item.id, item]));

    for (const product of products) {
      byProduct.set(product.id, {
        ...product,
        updated: new Date(product.updated_at).toLocaleDateString(),
        prices: [],
        priceLabel: "—",
        variantCount: 0,
        stock: null,
        category: product.category_id ? (categoryById.get(product.category_id)?.name ?? null) : null,
      });
    }

    const stockByVariant = totalStockByVariant(inventory);

    for (const variant of variants) {
      const row = byProduct.get(variant.product_id);
      if (!row) continue;
      row.variantCount += 1;
      row.prices.push(cents(variant.price_cents));
      const available = stockByVariant.get(variant.id);
      if (available !== undefined) row.stock = (row.stock ?? 0) + available;
    }

    for (const row of byProduct.values()) {
      row.priceLabel = priceRange(row.prices, currency, locale) ?? "—";
    }

    const term = filter.trim().toLowerCase();
    const allowedCategories =
      category === "all" ? null : categoryDescendantIds(categories, category);
    const matches = [...byProduct.values()].filter((product) => {
      if (status !== "all" && product.status !== status) return false;
      if (allowedCategories) {
        if (!product.category_id || !allowedCategories.has(product.category_id)) return false;
      }
      if (!term) return true;
      if ([product.title, product.slug, product.vendor ?? ""].some((value) =>
        value.toLowerCase().includes(term),
      )) {
        return true;
      }
      return (variantRows.get(product.id) ?? []).some((variant) =>
        [variant.sku ?? "", variant.barcode ?? ""].some((value) =>
          value.toLowerCase().includes(term),
        ),
      );
    });

    const column = String(sortDescriptor.column);
    const direction = sortDescriptor.direction === "descending" ? -1 : 1;
    return matches.sort((a, b) => compare(a, b, column) * direction);
  }, [products, variants, variantRows, inventory, categories, filter, status, category, sortDescriptor, currency, locale]);

  function toggleExpanded(productId: string) {
    setExpanded((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId],
    );
  }

  /** Bulk status changes go out as one PATCH; the route revalidates itself. */
  function setSelectedStatus(next: ProductStatus) {
    const formData = new FormData();
    formData.set("intent", "set-status");
    formData.set("status", next);
    formData.set("ids", JSON.stringify(selected));
    setSelected([]);
    bulkFetcher.submit(formData, { method: "post" });
  }

  /** Exports the rows the filters currently show, one line per variant. */
  function exportCsv() {
    const header = [
      "Product",
      "Slug",
      "Status",
      "Vendor",
      "Type",
      "Category",
      "Variant",
      "SKU",
      "Barcode",
      "Price",
      "Compare at",
      "Cost",
      "Stock",
      "Updated",
    ];
    const money = (value: number | null) => (value === null ? "" : String(value / 100));
    const lines: Array<Array<string | number>> = [header];

    for (const row of rows) {
      const productVariants = variantRows.get(row.id) ?? [];
      if (productVariants.length === 0) {
        lines.push([
          row.title,
          row.slug,
          row.status,
          row.vendor ?? "",
          row.product_type ?? "",
          row.category ?? "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          row.updated,
        ]);
        continue;
      }

      for (const variant of productVariants) {
        lines.push([
          row.title,
          row.slug,
          row.status,
          row.vendor ?? "",
          row.product_type ?? "",
          row.category ?? "",
          variant.title,
          variant.sku ?? "",
          variant.barcode ?? "",
          money(variant.price),
          money(variant.compareAt),
          money(variant.cost),
          variant.stock ?? "",
          row.updated,
        ]);
      }
    }

    const csv = lines
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `products-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Products"
        description="Everything you sell in this store."
        actions={
          <>
            <Button size="sm" variant="secondary" onPress={exportCsv}>
              <ArrowDownToLine className="size-4" />
              Export
            </Button>
            <Button size="sm" onPress={() => navigate("/admin/products/new")}>
              <Plus className="size-4" />
              New product
            </Button>
          </>
        }
      />

      <Card>
        <Card.Header className="flex-row flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <SearchField
              aria-label="Search products"
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
                Status: {status === "all" ? "All" : status}
              </Button>
              <Dropdown.Popover>
                <Dropdown.Menu
                  selectedKeys={[status]}
                  selectionMode="single"
                  onSelectionChange={(keys) => {
                    const [key] = [...keys];
                    if (typeof key === "string") setStatus(key as StatusFilter);
                  }}
                >
                  {STATUS_FILTERS.map((option) => (
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
                Category: {category === "all" ? "All" : categoryPath(categories, category)}
              </Button>
              <Dropdown.Popover>
                <Dropdown.Menu
                  selectedKeys={[category]}
                  selectionMode="single"
                  onSelectionChange={(keys) => {
                    const [key] = [...keys];
                    if (typeof key === "string") setCategory(key);
                  }}
                >
                  <Dropdown.Item id="all" textValue="All categories">
                    <Label>All categories</Label>
                    <Dropdown.ItemIndicator />
                  </Dropdown.Item>
                  {categoryTree(categories).map(({ category: option }) => (
                    <Dropdown.Item
                      key={option.id}
                      id={option.id}
                      textValue={categoryPath(categories, option.id)}
                    >
                      <Label>{categoryPath(categories, option.id)}</Label>
                      <Dropdown.ItemIndicator />
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
            {selected.length > 0 && (
              <div className="flex items-center gap-1 rounded-full bg-surface-secondary py-1 ps-3 pe-1">
                <span className="text-xs font-medium">{selected.length} selected</span>
                <Dropdown>
                  <Button size="sm" variant="tertiary" isDisabled={bulkBusy}>
                    Set status
                    <ChevronDown className="size-3.5 text-muted" />
                  </Button>
                  <Dropdown.Popover>
                    <Dropdown.Menu onAction={(key) => void setSelectedStatus(key as ProductStatus)}>
                      {PRODUCT_STATUSES.map((status) => (
                        <Dropdown.Item key={status} id={status} textValue={status}>
                          <Label>{status}</Label>
                        </Dropdown.Item>
                      ))}
                    </Dropdown.Menu>
                  </Dropdown.Popover>
                </Dropdown>
                <Button size="sm" variant="tertiary" onPress={() => setSelected([])}>
                  Clear
                </Button>
              </div>
            )}
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
          {bulkError && <p className="mb-3 text-sm text-danger">{bulkError}</p>}
          {rows.length === 0 ? (
            <p className="mx-auto max-w-md py-12 text-center text-sm text-muted">
              {products.length === 0
                ? "No products yet. Create your first one."
                : "No products match your filters."}
            </p>
          ) : (
            <Table>
              <Table.ScrollContainer>
                <Table.Content
                  aria-label="Products"
                  className="min-w-[900px]"
                  selectionMode="multiple"
                  selectedKeys={selected}
                  onSelectionChange={(keys) => setSelected([...keys].map(String))}
                  sortDescriptor={sortDescriptor}
                  onSortChange={setSortDescriptor}
                >
                  <Table.Header>
                    <Table.Column className="w-10">
                      <Checkbox slot="selection" aria-label="Select all products">
                        <Checkbox.Content>
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                        </Checkbox.Content>
                      </Checkbox>
                    </Table.Column>
                    <Table.Column allowsSorting id="title" isRowHeader>
                      {({ sortDirection }) => (
                        <Table.SortableColumnHeader sortDirection={sortDirection}>
                          Product
                        </Table.SortableColumnHeader>
                      )}
                    </Table.Column>
                    <Table.Column id="category">Category</Table.Column>
                    <Table.Column allowsSorting id="status">
                      {({ sortDirection }) => (
                        <Table.SortableColumnHeader sortDirection={sortDirection}>
                          Status
                        </Table.SortableColumnHeader>
                      )}
                    </Table.Column>
                    <Table.Column allowsSorting id="price">
                      {({ sortDirection }) => (
                        <Table.SortableColumnHeader sortDirection={sortDirection}>
                          Price
                        </Table.SortableColumnHeader>
                      )}
                    </Table.Column>
                    <Table.Column allowsSorting id="stock">
                      {({ sortDirection }) => (
                        <Table.SortableColumnHeader sortDirection={sortDirection}>
                          Stock
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
                    {rows.map((product) => {
                      const open = expanded.includes(product.id);
                      return (
                        <Fragment key={product.id}>
                          <Table.Row id={product.id}>
                            <Table.Cell>
                              <Checkbox
                                slot="selection"
                                aria-label={`Select ${product.title}`}
                              >
                                <Checkbox.Content>
                                  <Checkbox.Control>
                                    <Checkbox.Indicator />
                                  </Checkbox.Control>
                                </Checkbox.Content>
                              </Checkbox>
                            </Table.Cell>
                            <Table.Cell>
                              <div className="flex items-center gap-3">
                                {product.variantCount > 1 ? (
                                  <Button
                                    aria-label={
                                      open
                                        ? `Collapse ${product.title} variants`
                                        : `Expand ${product.title} variants`
                                    }
                                    aria-expanded={open}
                                    isIconOnly
                                    size="sm"
                                    variant="tertiary"
                                    className="shrink-0"
                                    onPress={() => toggleExpanded(product.id)}
                                  >
                                    <ChevronRight
                                      className={
                                        open
                                          ? "size-4 rotate-90 transition-transform"
                                          : "size-4 transition-transform"
                                      }
                                    />
                                  </Button>
                                ) : (
                                  <span aria-hidden className="w-8 shrink-0" />
                                )}
                                {imageByProduct.get(product.id) ? (
                                  <img
                                    src={imageByProduct.get(product.id)}
                                    alt=""
                                    className="size-10 shrink-0 rounded-lg object-cover"
                                  />
                                ) : (
                                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-muted">
                                    <Picture className="size-4" />
                                  </span>
                                )}
                                <Link
                                  className="flex min-w-0 flex-1 flex-col items-start no-underline"
                                  href={`/admin/products/${product.id}`}
                                >
                                  <span className="truncate font-medium text-foreground">
                                    {product.title}
                                  </span>
                                  <span className="truncate text-xs text-muted">
                                    {product.slug} · {product.variantCount}{" "}
                                    {product.variantCount === 1 ? "variant" : "variants"}
                                  </span>
                                </Link>
                              </div>
                            </Table.Cell>
                            <Table.Cell className="text-muted">
                              {product.category ?? "—"}
                            </Table.Cell>
                            <Table.Cell>
                              <Chip color={STATUS_COLOR[product.status]} size="sm" variant="soft">
                                {product.status}
                              </Chip>
                            </Table.Cell>
                            <Table.Cell className="tabular-nums">{product.priceLabel}</Table.Cell>
                            <Table.Cell>
                              {product.stock === null ? (
                                <span className="text-muted">—</span>
                              ) : (
                                <Chip
                                  color={product.stock > 0 ? "success" : "warning"}
                                  size="sm"
                                  variant="soft"
                                >
                                  {product.stock} available
                                </Chip>
                              )}
                            </Table.Cell>
                            <Table.Cell className="text-muted">{product.updated}</Table.Cell>
                            <Table.Cell className="text-end">
                              <Link
                                className="text-sm font-medium no-underline"
                                href={`/admin/products/${product.id}`}
                              >
                                Edit
                              </Link>
                            </Table.Cell>
                          </Table.Row>

                          {open && (
                            <Table.Row id={`${product.id}-variants`}>
                              <Table.Cell colSpan={8}>
                                <div className="flex flex-col gap-2 py-1">
                                  <div className="flex items-center gap-4 text-xs font-medium text-muted">
                                    <span className="w-48">Variant</span>
                                    <span className="w-32">SKU</span>
                                    <span className="w-28">Price</span>
                                    <span>Stock</span>
                                  </div>
                                  {(variantRows.get(product.id) ?? []).map((variant) => (
                                    <div key={variant.id} className="flex items-center gap-4 text-xs">
                                      <span className="w-48 truncate font-medium">
                                        {variant.title}
                                      </span>
                                      <span className="w-32 truncate text-muted">
                                        {variant.sku ?? "—"}
                                      </span>
                                      <span className="w-28 tabular-nums">{variant.priceLabel}</span>
                                      <span className="text-muted">
                                        {variant.stock === undefined
                                          ? "—"
                                          : `${variant.stock} available`}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </Table.Cell>
                            </Table.Row>
                          )}
                        </Fragment>
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
export { ProductListing as Component, productListingLoader as loader, productListingAction as action };
