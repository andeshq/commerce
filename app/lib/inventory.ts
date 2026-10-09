import type { InventoryLevel, InventoryMovement } from "./catalog";
import { pgbase } from "./pgbase";

/**
 * Square's stock actions: additions, deductions, and physical recounts that set
 * the counted quantity. Kept in sync with `INVENTORY_REASONS` in the API.
 */
export const INVENTORY_ACTIONS = [
  {
    id: "stock_received",
    label: "Stock received",
    direction: "in",
    inputLabel: "Received",
  },
  {
    id: "inventory_recount",
    label: "Inventory recount",
    direction: "recount",
    inputLabel: "Counted quantity",
  },
  { id: "damage", label: "Damage", direction: "out", inputLabel: "Removed" },
  { id: "theft", label: "Theft", direction: "out", inputLabel: "Removed" },
  { id: "loss", label: "Loss", direction: "out", inputLabel: "Removed" },
  {
    id: "restock_return",
    label: "Restock return",
    direction: "in",
    inputLabel: "Returned",
  },
] as const;

export type InventoryAction = (typeof INVENTORY_ACTIONS)[number];
export type InventoryReason = InventoryAction["id"];
export type InventoryDirection = InventoryAction["direction"];

/** One variant flattened for the inventory table and item pickers. */
export interface InventoryItemRow {
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
}

export function inventoryAction(reason: string): InventoryAction | undefined {
  return INVENTORY_ACTIONS.find((action) => action.id === reason);
}

export function reasonLabel(reason: string): string {
  return inventoryAction(reason)?.label ?? reason;
}

/** Notes live in `metadata.note`; tolerate rows stored as JSON strings. */
export function movementNote(movement: InventoryMovement): string | null {
  const metadata = movement.metadata;
  if (!metadata) return null;

  let value: unknown = metadata;
  if (typeof metadata === "string") {
    try {
      value = JSON.parse(metadata);
    } catch {
      return null;
    }
  }

  if (typeof value !== "object" || value === null) return null;
  const note = (value as { note?: unknown }).note;
  return typeof note === "string" && note.trim() ? note : null;
}

/** On hand per variant, summed across locations. */
export function totalStockByVariant(levels: InventoryLevel[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const level of levels) {
    totals.set(level.variant_id, (totals.get(level.variant_id) ?? 0) + level.available);
  }
  return totals;
}

/** On hand for one variant at one location; missing rows read as zero. */
export function levelFor(
  levels: InventoryLevel[],
  variantId: string,
  locationId: string,
): number {
  return (
    levels.find((level) => level.variant_id === variantId && level.location_id === locationId)
      ?.available ?? 0
  );
}

/** Local echo of an adjustment, so tables update without a data reload. */
export function upsertLevel(
  levels: InventoryLevel[],
  variantId: string,
  locationId: string,
  available: number,
): InventoryLevel[] {
  const next = levels.filter(
    (level) => !(level.variant_id === variantId && level.location_id === locationId),
  );
  next.push({
    variant_id: variantId,
    location_id: locationId,
    available,
    updated_at: new Date().toISOString(),
  });
  return next;
}

export interface AdjustStockInput {
  variantId: string;
  locationId: string;
  reason: InventoryReason;
  quantity: number;
  note?: string;
}

/** Stock writes go through the `adjust_inventory` database function (RPC). */
export async function adjustStock(input: AdjustStockInput): Promise<{ available: number }> {
  const { data } = await pgbase
    .rpc("adjust_inventory", {
      variant: input.variantId,
      location: input.locationId,
      reason: input.reason,
      quantity: input.quantity,
      note: input.note ?? null,
    })
    .throwOnError();

  const row = (Array.isArray(data) ? data[0] : data) as { available: number } | null;
  if (!row) throw new Error("The adjustment did not return a stock level.");
  return { available: row.available };
}
