import { useEffect, useMemo, useState } from "react";
import { Button, Card, Chip, Dropdown, Label, Link, SearchField, Separator, Table } from "@heroui/react";
import type { SortDescriptor } from "@heroui/react";
import { BarsDescendingAlignLeft, EllipsisVertical, Picture } from "@gravity-ui/icons";
import { useLoaderData, useRevalidator } from "react-router";
import { PageHeader } from "@/lib/page-header";
import { pgbase } from "@/lib/pgbase";
import {
  AdjustStockDialog,
  ManageLocationsDialog,
  StockHistoryDialog,
} from "@/lib/inventory-dialogs";
import type { InventoryItemRow } from "@/lib/inventory";
import type {
  InventoryLevel,
  InventoryLocation,
  Media,
  Product,
  ProductMediaLink,
  Variant,
} from "@/lib/catalog";

export async function inventoryListingLoader() {
  const [products, variants, inventory, locations, media, productMedia] = await Promise.all([
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
      .from("inventory_locations")
      .select("id,name,code,address,active,is_default")
      .order("name", { ascending: true })
      .throwOnError(),
    pgbase.from("media").select("id,url,alt,width,height").throwOnError(),
    pgbase
      .from("product_media")
      .select("product_id,media_id,position")
      .order("position", { ascending: true })
      .throwOnError(),
  ]);

  return {
    products: products.data as Product[],
    variants: variants.data as Variant[],
    inventory: inventory.data as InventoryLevel[],
    locations: locations.data as InventoryLocation[],
    media: media.data as Media[],
    productMedia: productMedia.data as ProductMediaLink[],
  };
}

type StatusFilter = "all" | "in" | "out";
type LocationFilter = "all" | string;

const STATUS_FILTERS = [
  { id: "all", label: "All stock" },
  { id: "in", label: "In stock" },
  { id: "out", label: "Out of stock" },
] as const;

const SORT_OPTIONS = [
  { id: "name", label: "Item A–Z", column: "item", direction: "ascending" },
  { id: "updated", label: "Recently updated", column: "updated", direction: "descending" },
  { id: "stock_low", label: "Lowest stock", column: "onHand", direction: "ascending" },
  { id: "stock_high", label: "Highest stock", column: "onHand", direction: "descending" },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  column: SortDescriptor["column"];
  direction: SortDescriptor["direction"];
}>;

interface Row extends InventoryItemRow {
  productTitle: string;
  thumb: string | null;
  onHand: number;
  updatedAt: string | null;
}

function compare(a: Row, b: Row, column: string): number {
  if (column === "onHand") return a.onHand - b.onHand;
  if (column === "updated") return (a.updatedAt ?? "").localeCompare(b.updatedAt ?? "");
  return `${a.productTitle} ${a.variantTitle}`.localeCompare(`${b.productTitle} ${b.variantTitle}`);
}

export function InventoryListing() {
  const { products, variants, inventory, locations, media, productMedia } =
    useLoaderData<Awaited<ReturnType<typeof inventoryListingLoader>>>();
  const revalidator = useRevalidator();

  const [filter, setFilter] = useState("");
  const [locationId, setLocationId] = useState<LocationFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: "item",
    direction: "ascending",
  });
  const [adjust, setAdjust] = useState<{
    open: boolean;
    variantId?: string;
    locationId?: string;
  }>({ open: false });
  const [history, setHistory] = useState<{ open: boolean; item: InventoryItemRow | null }>({
    open: false,
    item: null,
  });
  const [manageLocations, setManageLocations] = useState(false);

  const activeLocations = useMemo(
    () => locations.filter((location) => location.active),
    [locations],
  );

  // A deleted location clears the filter instead of pointing nowhere.
  useEffect(() => {
    if (locationId !== "all" && !locations.some((location) => location.id === locationId)) {
      setLocationId("all");
    }
  }, [locations, locationId]);

  /** Every non-archived variant, for the table and the adjust picker. */
  const itemRows = useMemo<Row[]>(() => {
    const productById = new Map(products.map((product) => [product.id, product]));
    const mediaById = new Map(media.map((entry) => [entry.id, entry]));
    const thumbByProduct = new Map<string, string>();
    for (const link of productMedia) {
      if (thumbByProduct.has(link.product_id)) continue;
      const entry = mediaById.get(link.media_id);
      if (entry) thumbByProduct.set(link.product_id, entry.url);
    }

    return variants.flatMap((variant) => {
      const product = productById.get(variant.product_id);
      if (!product || product.status === "archived") return [];
      return [
        {
          variantId: variant.id,
          productId: product.id,
          productTitle: product.title,
          variantTitle: variant.title,
          sku: variant.sku,
          thumb: thumbByProduct.get(product.id) ?? null,
          onHand: 0,
          updatedAt: null,
        },
      ];
    });
  }, [products, variants, media, productMedia]);

  const rows = useMemo(() => {
    const levelsByVariant = new Map<string, InventoryLevel[]>();
    for (const level of inventory) {
      const list = levelsByVariant.get(level.variant_id) ?? [];
      list.push(level);
      levelsByVariant.set(level.variant_id, list);
    }

    const term = filter.trim().toLowerCase();
    const filtered = itemRows
      .map((row) => ({ ...row }))
      .filter((row) => {
        const scoped =
          locationId === "all"
            ? (levelsByVariant.get(row.variantId) ?? [])
            : (levelsByVariant.get(row.variantId) ?? []).filter(
                (level) => level.location_id === locationId,
              );
        row.onHand = scoped.reduce((sum, level) => sum + level.available, 0);
        row.updatedAt = scoped.reduce<string | null>(
          (max, level) => (max === null || level.updated_at > max ? level.updated_at : max),
          null,
        );

        if (status === "in" && row.onHand <= 0) return false;
        if (status === "out" && row.onHand > 0) return false;
        if (!term) return true;
        return [row.productTitle, row.variantTitle, row.sku ?? ""].some((value) =>
          value.toLowerCase().includes(term),
        );
      });

    const column = String(sortDescriptor.column);
    const direction = sortDescriptor.direction === "descending" ? -1 : 1;
    return filtered.sort((a, b) => compare(a, b, column) * direction);
  }, [itemRows, inventory, filter, locationId, status, sortDescriptor]);

  const activeSort =
    SORT_OPTIONS.find(
      (option) =>
        option.column === sortDescriptor.column && option.direction === sortDescriptor.direction,
    )?.id ?? "name";

  function openAdjust(row?: Row) {
    setAdjust({
      open: true,
      variantId: row?.variantId,
      locationId: locationId === "all" ? activeLocations[0]?.id : locationId,
    });
  }

  function openHistory(row: Row) {
    setHistory({ open: true, item: row });
  }

  const currentLocation = locations.find((location) => location.id === locationId);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Inventory"
        description="On hand by variant and location."
        actions={
          <Button size="sm" onPress={() => openAdjust()}>
            Adjust stock
          </Button>
        }
      />

      <Card>
        <Card.Header className="flex-row flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <SearchField
              aria-label="Search inventory"
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
                Location: {currentLocation?.name ?? "All"}
              </Button>
              <Dropdown.Popover>
                <Dropdown.Menu
                  selectedKeys={[locationId]}
                  selectionMode="single"
                  onSelectionChange={(keys) => {
                    const [key] = [...keys];
                    if (typeof key !== "string") return;
                    if (key === "manage") {
                      setManageLocations(true);
                      return;
                    }
                    setLocationId(key);
                  }}
                >
                  <Dropdown.Item id="all" textValue="All locations">
                    <Label>All locations</Label>
                    <Dropdown.ItemIndicator />
                  </Dropdown.Item>
                  {locations.map((location) => (
                    <Dropdown.Item
                      key={location.id}
                      id={location.id}
                      textValue={location.name}
                    >
                      <Label>
                        {location.name}
                        {location.active ? "" : " (inactive)"}
                      </Label>
                      <Dropdown.ItemIndicator />
                    </Dropdown.Item>
                  ))}
                  <Separator />
                  <Dropdown.Item id="manage" textValue="Manage locations">
                    <Label>Manage locations…</Label>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>

            <Dropdown>
              <Button size="sm" variant="secondary">
                Status: {STATUS_FILTERS.find((option) => option.id === status)?.label}
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
          </div>

          <Dropdown>
            <Button size="sm" variant="secondary">
              <BarsDescendingAlignLeft className="size-4" />
              Sort by
            </Button>
            <Dropdown.Popover>
              <Dropdown.Menu
                selectedKeys={[activeSort]}
                selectionMode="single"
                onSelectionChange={(keys) => {
                  const [key] = [...keys];
                  const option = SORT_OPTIONS.find((candidate) => candidate.id === key);
                  if (option) {
                    setSortDescriptor({ column: option.column, direction: option.direction });
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
          {itemRows.length === 0 ? (
            <p className="mx-auto max-w-md py-12 text-center text-sm text-muted">
              No products yet. Create one to start tracking stock.
            </p>
          ) : rows.length === 0 ? (
            <p className="mx-auto max-w-md py-12 text-center text-sm text-muted">
              No variants match your filters.
            </p>
          ) : (
            <Table>
              <Table.ScrollContainer>
                <Table.Content
                  aria-label="Inventory"
                  className="min-w-[900px]"
                  sortDescriptor={sortDescriptor}
                  onSortChange={setSortDescriptor}
                >
                  <Table.Header>
                    <Table.Column allowsSorting id="item" isRowHeader>
                      {({ sortDirection }) => (
                        <Table.SortableColumnHeader sortDirection={sortDirection}>
                          Item
                        </Table.SortableColumnHeader>
                      )}
                    </Table.Column>
                    <Table.Column id="sku">SKU</Table.Column>
                    <Table.Column allowsSorting id="onHand">
                      {({ sortDirection }) => (
                        <Table.SortableColumnHeader sortDirection={sortDirection}>
                          On hand
                        </Table.SortableColumnHeader>
                      )}
                    </Table.Column>
                    <Table.Column id="status">Status</Table.Column>
                    <Table.Column allowsSorting id="updated">
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
                      <Table.Row key={row.variantId} id={row.variantId}>
                        <Table.Cell>
                          <div className="flex items-center gap-3">
                            {row.thumb ? (
                              <img
                                src={row.thumb}
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
                              href={`/admin/products/${row.productId}`}
                            >
                              <span className="truncate font-medium text-foreground">
                                {row.productTitle}
                              </span>
                              <span className="truncate text-xs text-muted">
                                {row.variantTitle}
                              </span>
                            </Link>
                          </div>
                        </Table.Cell>
                        <Table.Cell className="font-mono text-xs text-muted">
                          {row.sku ?? "—"}
                        </Table.Cell>
                        <Table.Cell>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="tabular-nums"
                            aria-label={`Adjust stock for ${row.productTitle} ${row.variantTitle}`}
                            onPress={() => openAdjust(row)}
                          >
                            {row.onHand}
                          </Button>
                        </Table.Cell>
                        <Table.Cell>
                          <Chip color={row.onHand > 0 ? "success" : "warning"} size="sm" variant="soft">
                            {row.onHand > 0 ? "In stock" : "Out of stock"}
                          </Chip>
                        </Table.Cell>
                        <Table.Cell className="text-muted">
                          {row.updatedAt ? new Date(row.updatedAt).toLocaleDateString() : "—"}
                        </Table.Cell>
                        <Table.Cell className="text-end">
                          <Dropdown>
                            <Button
                              isIconOnly
                              size="sm"
                              variant="tertiary"
                              aria-label={`Actions for ${row.productTitle} ${row.variantTitle}`}
                            >
                              <EllipsisVertical className="size-4" />
                            </Button>
                            <Dropdown.Popover>
                              <Dropdown.Menu
                                onAction={(key) => {
                                  if (key === "adjust") openAdjust(row);
                                  if (key === "history") openHistory(row);
                                }}
                              >
                                <Dropdown.Item id="adjust" textValue="Adjust stock">
                                  <Label>Adjust stock</Label>
                                </Dropdown.Item>
                                <Dropdown.Item id="history" textValue="View stock history">
                                  <Label>View stock history</Label>
                                </Dropdown.Item>
                              </Dropdown.Menu>
                            </Dropdown.Popover>
                          </Dropdown>
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

      <AdjustStockDialog
        open={adjust.open}
        onOpenChange={(open) => setAdjust((current) => ({ ...current, open }))}
        items={itemRows}
        locations={activeLocations}
        levels={inventory}
        initial={{ variantId: adjust.variantId, locationId: adjust.locationId }}
        onAdjusted={() => void revalidator.revalidate()}
      />
      <StockHistoryDialog
        open={history.open}
        onOpenChange={(open) => setHistory((current) => ({ ...current, open }))}
        item={history.item}
        locations={activeLocations.length > 0 ? activeLocations : locations}
        levels={inventory}
        initialLocationId={locationId === "all" ? activeLocations[0]?.id : locationId}
      />
      <ManageLocationsDialog
        open={manageLocations}
        onOpenChange={setManageLocations}
        locations={locations}
        onChanged={() => void revalidator.revalidate()}
      />
    </div>
  );
}

/* React Router lazy-route contract. */
export { InventoryListing as Component, inventoryListingLoader as loader };
