import { useEffect, useState } from "react";
import {
  Alert,
  Autocomplete,
  Button,
  Chip,
  Input,
  Label,
  ListBox,
  Modal,
  NumberField,
  SearchField,
  Select,
  Spinner,
  Switch,
  TextField,
  useFilter,
} from "@heroui/react";
import { Pencil, Plus, Star, TrashBin } from "@gravity-ui/icons";
import { pgbase, pgbaseErrorMessages } from "@/lib/pgbase";
import type {
  InventoryLevel,
  InventoryLocation,
  InventoryMovement,
  LocationAddress,
} from "@/lib/catalog";
import {
  adjustStock,
  INVENTORY_ACTIONS,
  inventoryAction,
  levelFor,
  movementNote,
  reasonLabel,
  type InventoryItemRow,
  type InventoryReason,
} from "@/lib/inventory";

/**
 * Square-style stock popover, as a dialog: pick a stock action, enter units in
 * that action's direction, and watch the new total before committing.
 */
export function AdjustStockDialog({
  open,
  onOpenChange,
  items,
  locations,
  levels,
  initial,
  onAdjusted,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Every variant that can be picked when opened without one. */
  items: InventoryItemRow[];
  /** Active locations only. */
  locations: InventoryLocation[];
  levels: InventoryLevel[];
  initial?: { variantId?: string; locationId?: string };
  onAdjusted(variantId: string, locationId: string, available: number): void;
}) {
  const { contains } = useFilter({ sensitivity: "base" });
  const [picker, setPicker] = useState(false);
  const [variantId, setVariantId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [reason, setReason] = useState<InventoryReason>("stock_received");
  const [quantity, setQuantity] = useState(0);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPicker(!initial?.variantId);
    setVariantId(initial?.variantId ?? "");
    setLocationId(initial?.locationId ?? locations[0]?.id ?? "");
    setReason("stock_received");
    setQuantity(0);
    setNote("");
    setError(null);
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset per open only
  }, [open]);

  const item = items.find((candidate) => candidate.variantId === variantId) ?? null;
  const action = inventoryAction(reason) ?? INVENTORY_ACTIONS[0];
  const location = locations.find((candidate) => candidate.id === locationId) ?? null;

  const current = item && locationId ? levelFor(levels, item.variantId, locationId) : 0;
  const total =
    action.direction === "recount"
      ? quantity
      : action.direction === "in"
        ? current + quantity
        : current - quantity;

  const hint =
    !item || !locationId
      ? null
      : total < 0
        ? `Only ${current} on hand at ${location?.name ?? "this location"}.`
        : total === current
          ? "No change to record."
          : null;
  const invalid = Boolean(hint) || !item || !locationId;

  async function submit() {
    if (invalid || !item || !locationId) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await adjustStock({
        variantId: item.variantId,
        locationId,
        reason,
        quantity,
        note: note.trim() || undefined,
      });
      onAdjusted(item.variantId, locationId, result.available);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[440px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Adjust stock</Modal.Heading>
            </Modal.Header>

            <Modal.Body className="flex flex-col gap-4">
              {error && (
                <Alert status="danger">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Description>{error}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}

              {item && !picker ? (
                <div className="flex items-center gap-3 rounded-2xl border border-field-border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.productTitle}</p>
                    <p className="truncate text-xs text-muted">
                      {item.variantTitle}
                      {item.sku ? ` · ${item.sku}` : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="tertiary"
                    isDisabled={submitting}
                    onPress={() => setPicker(true)}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <Autocomplete
                  className="w-full"
                  placeholder="Select an item"
                  selectionMode="single"
                  value={variantId || null}
                  onChange={(key) => {
                    setVariantId(key == null ? "" : String(key));
                    setPicker(false);
                  }}
                >
                  <Label>Item</Label>
                  <Autocomplete.Trigger>
                    <Autocomplete.Value />
                    <Autocomplete.ClearButton />
                    <Autocomplete.Indicator />
                  </Autocomplete.Trigger>
                  <Autocomplete.Popover>
                    <Autocomplete.Filter filter={contains}>
                      <SearchField
                        autoFocus
                        aria-label="Search items"
                        name="search"
                        variant="secondary"
                      >
                        <SearchField.Group>
                          <SearchField.SearchIcon />
                          <SearchField.Input placeholder="Search by product or SKU" />
                          <SearchField.ClearButton />
                        </SearchField.Group>
                      </SearchField>
                      <ListBox
                        renderEmptyState={() => (
                          <p className="p-3 text-sm text-muted">No items found.</p>
                        )}
                      >
                        {items.map((candidate) => (
                          <ListBox.Item
                            key={candidate.variantId}
                            id={candidate.variantId}
                            textValue={`${candidate.productTitle} ${candidate.variantTitle} ${candidate.sku ?? ""}`}
                          >
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate">
                                {candidate.productTitle} — {candidate.variantTitle}
                              </span>
                              <span className="truncate text-xs text-muted">
                                {candidate.sku ?? "No SKU"}
                              </span>
                            </span>
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Autocomplete.Filter>
                  </Autocomplete.Popover>
                </Autocomplete>
              )}

              <Select
                fullWidth
                value={locationId}
                onChange={(value) => setLocationId(String(value))}
                isDisabled={locations.length <= 1}
              >
                <Label>Location</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {locations.map((candidate) => (
                      <ListBox.Item
                        key={candidate.id}
                        id={candidate.id}
                        textValue={candidate.name}
                      >
                        {candidate.name}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>

              <Select
                fullWidth
                value={reason}
                onChange={(value) => setReason(String(value) as InventoryReason)}
              >
                <Label>Stock action</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {INVENTORY_ACTIONS.map((candidate) => (
                      <ListBox.Item
                        key={candidate.id}
                        id={candidate.id}
                        textValue={candidate.label}
                      >
                        {candidate.label}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>

              <NumberField
                value={quantity}
                onChange={(value) => setQuantity(value ?? 0)}
                minValue={0}
                maxValue={1_000_000}
              >
                <Label>{action.inputLabel}</Label>
                <NumberField.Group>
                  <NumberField.DecrementButton />
                  <NumberField.Input className="w-full" />
                  <NumberField.IncrementButton />
                </NumberField.Group>
              </NumberField>

              <TextField fullWidth value={note} onChange={setNote} isDisabled={submitting}>
                <Label>Note</Label>
                <Input placeholder="Optional, e.g. supplier invoice" />
              </TextField>

              <div className="flex flex-col gap-1.5 rounded-2xl bg-surface-secondary p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted">Current stock</span>
                  <span className="tabular-nums">{current}</span>
                </div>
                {action.direction !== "recount" && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted">{action.inputLabel}</span>
                    <span className="tabular-nums">
                      {action.direction === "in" ? "+" : "−"}
                      {quantity}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between font-medium">
                  <span>New total</span>
                  <span className="tabular-nums">{total}</span>
                </div>
                {hint && <p className="text-xs text-danger">{hint}</p>}
              </div>
            </Modal.Body>

            <Modal.Footer>
              <Button
                variant="secondary"
                isDisabled={submitting}
                onPress={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button isDisabled={invalid || submitting} isPending={submitting} onPress={submit}>
                Adjust stock
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

/**
 * One location's movement log, newest first, each row showing the resulting
 * on hand (Square calls it "Total on hand").
 */
export function StockHistoryDialog({
  open,
  onOpenChange,
  item,
  locations,
  levels,
  initialLocationId,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  item: InventoryItemRow | null;
  locations: InventoryLocation[];
  levels: InventoryLevel[];
  initialLocationId?: string;
}) {
  const [locationId, setLocationId] = useState("");
  const [movements, setMovements] = useState<InventoryMovement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLocationId(initialLocationId ?? locations[0]?.id ?? "");
    setMovements(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset per open only
  }, [open]);

  useEffect(() => {
    if (!open || !item || !locationId) return;
    let cancelled = false;

    setMovements(null);
    setError(null);
    void (async () => {
      try {
        const { data } = await pgbase
          .from("inventory_movements")
          .select(
            "id,variant_id,location_id,delta,reason,reference,metadata,created_by,created_by_name,created_at",
          )
          .eq("variant_id", item.variantId)
          .eq("location_id", locationId)
          .order("created_at", { ascending: false })
          .limit(200)
          .throwOnError();
        if (!cancelled) setMovements((data ?? []) as InventoryMovement[]);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Could not load stock history.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, item?.variantId, locationId]);

  let running = item ? levelFor(levels, item.variantId, locationId) : 0;
  const rows = (movements ?? []).map((movement) => {
    const after = running;
    running -= movement.delta;
    return { movement, after };
  });

  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[460px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Stock history</Modal.Heading>
            </Modal.Header>

            <Modal.Body className="flex flex-col gap-4">
              {item && (
                <div className="flex flex-col">
                  <p className="truncate text-sm font-medium">{item.productTitle}</p>
                  <p className="truncate text-xs text-muted">
                    {item.variantTitle}
                    {item.sku ? ` · ${item.sku}` : ""}
                  </p>
                </div>
              )}

              <Select
                fullWidth
                value={locationId}
                onChange={(value) => setLocationId(String(value))}
                isDisabled={locations.length <= 1}
              >
                <Label>Location</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {locations.map((candidate) => (
                      <ListBox.Item key={candidate.id} id={candidate.id} textValue={candidate.name}>
                        {candidate.name}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>

              {error ? (
                <Alert status="danger">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Description>{error}</Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : movements === null ? (
                <div className="flex justify-center py-8">
                  <Spinner />
                </div>
              ) : rows.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">
                  No stock movements at this location yet.
                </p>
              ) : (
                <div className="-my-1 flex max-h-80 flex-col overflow-y-auto">
                  {rows.map(({ movement, after }) => {
                    const note = movementNote(movement);

                    return (
                      <div
                        key={movement.id}
                        className="flex items-start gap-3 border-b border-field-border py-3 last:border-b-0"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{reasonLabel(movement.reason)}</p>
                          <p className="text-xs text-muted">
                            {new Date(movement.created_at).toLocaleString()}
                            {movement.created_by_name ? ` · by ${movement.created_by_name}` : ""}
                          </p>
                          {note && <p className="mt-0.5 text-xs">{note}</p>}
                        </div>
                        <div className="text-end">
                          <p
                            className={
                              "text-sm tabular-nums " +
                              (movement.delta > 0 ? "text-success" : "text-danger")
                            }
                          >
                            {movement.delta > 0
                              ? `+${movement.delta}`
                              : `−${Math.abs(movement.delta)}`}
                          </p>
                          <p className="text-xs text-muted tabular-nums">{after} on hand</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Modal.Body>

            <Modal.Footer>
              <Button variant="secondary" onPress={() => onOpenChange(false)}>
                Close
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

interface LocationDraft {
  id: string | null;
  name: string;
  code: string;
  active: boolean;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

const EMPTY_LOCATION: LocationDraft = {
  id: null,
  name: "",
  code: "",
  active: true,
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
  country: "",
};

function draftFromLocation(location: InventoryLocation): LocationDraft {
  return {
    id: location.id,
    name: location.name,
    code: location.code ?? "",
    active: location.active,
    line1: location.address.line1 ?? "",
    line2: location.address.line2 ?? "",
    city: location.address.city ?? "",
    region: location.address.region ?? "",
    postalCode: location.address.postalCode ?? "",
    country: location.address.country ?? "",
  };
}

/** Drops empty fields, so an untouched address stays `{}`. */
function addressFromDraft(draft: LocationDraft): LocationAddress {
  const address: LocationAddress = {};
  const set = (key: keyof LocationAddress, value: string) => {
    const trimmed = value.trim();
    if (trimmed) address[key] = trimmed;
  };
  set("line1", draft.line1);
  set("line2", draft.line2);
  set("city", draft.city);
  set("region", draft.region);
  set("postalCode", draft.postalCode);
  set("country", draft.country);
  return address;
}

/** One line for the list: "Calle 123 · Bogotá, Colombia". */
function addressSummary(address: LocationAddress): string {
  const locality = [address.city, address.country].filter(Boolean).join(", ");
  return [address.line1, locality].filter(Boolean).join(" · ");
}

/**
 * Locations are deactivated, never deleted: levels and movements hang off them.
 */
export function ManageLocationsDialog({
  open,
  onOpenChange,
  locations,
  onChanged,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  locations: InventoryLocation[];
  onChanged(locations: InventoryLocation[]): void;
}) {
  const [editing, setEditing] = useState<LocationDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setEditing(null);
    setError(null);
    setSaving(false);
  }, [open]);

  async function refresh() {
    const { data } = await pgbase
      .from("inventory_locations")
      .select("id,name,code,address,active,is_default")
      .order("name", { ascending: true })
      .throwOnError();
    onChanged((data ?? []) as InventoryLocation[]);
  }

  async function save() {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) return;

    setSaving(true);
    setError(null);
    try {
      const code = editing.code.trim() || null;
      const address = addressFromDraft(editing);
      if (editing.id) {
        await pgbase
          .from("inventory_locations")
          .update({ name, code, address, active: editing.active })
          .eq("id", editing.id)
          .throwOnError();
      } else {
        await pgbase
          .from("inventory_locations")
          .insert({ name, code, address })
          .throwOnError();
      }
      await refresh();
      setEditing(null);
    } catch (caught) {
      setError(pgbaseErrorMessages(caught)[0] ?? null);
    } finally {
      setSaving(false);
    }
  }

  /** Deleting a location cascades its levels and movement history. */
  async function remove(location: InventoryLocation) {
    const confirmed = window.confirm(
      `Delete "${location.name}"?\n\n` +
        "Its stock levels and stock movement history are deleted too. This cannot be undone.",
    );
    if (!confirmed) return;

    setSaving(true);
    setError(null);
    try {
      await pgbase.from("inventory_locations").delete().eq("id", location.id).throwOnError();
      await refresh();
    } catch (caught) {
      setError(pgbaseErrorMessages(caught)[0] ?? null);
    } finally {
      setSaving(false);
    }
  }

  /** Checkout takes stock from the default location. */
  async function setDefault(location: InventoryLocation) {
    setSaving(true);
    setError(null);
    try {
      await pgbase.rpc("set_default_location", { location: location.id }).throwOnError();
      await refresh();
    } catch (caught) {
      setError(pgbaseErrorMessages(caught)[0] ?? null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[440px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{editing ? "Location" : "Locations"}</Modal.Heading>
            </Modal.Header>

            <Modal.Body className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
              {error && (
                <Alert status="danger">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Description>{error}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}

              {editing ? (
                <div className="flex flex-col gap-4">
                  <TextField
                    fullWidth
                    isRequired
                    value={editing.name}
                    onChange={(value) => setEditing({ ...editing, name: value })}
                  >
                    <Label>Name</Label>
                    <Input placeholder="Bodega Norte" />
                  </TextField>
                  <TextField
                    fullWidth
                    value={editing.code}
                    onChange={(value) => setEditing({ ...editing, code: value })}
                  >
                    <Label>Code</Label>
                    <Input placeholder="NORTE" />
                  </TextField>

                  <TextField
                    fullWidth
                    value={editing.line1}
                    onChange={(value) => setEditing({ ...editing, line1: value })}
                  >
                    <Label>Address</Label>
                    <Input placeholder="Calle 123 #45-67" />
                  </TextField>
                  <TextField
                    fullWidth
                    value={editing.line2}
                    onChange={(value) => setEditing({ ...editing, line2: value })}
                  >
                    <Label>Address line 2</Label>
                    <Input placeholder="Apto 401" />
                  </TextField>
                  <div className="grid grid-cols-2 gap-3">
                    <TextField
                      fullWidth
                      value={editing.city}
                      onChange={(value) => setEditing({ ...editing, city: value })}
                    >
                      <Label>City</Label>
                      <Input placeholder="Bogotá" />
                    </TextField>
                    <TextField
                      fullWidth
                      value={editing.region}
                      onChange={(value) => setEditing({ ...editing, region: value })}
                    >
                      <Label>Region</Label>
                      <Input placeholder="Cundinamarca" />
                    </TextField>
                    <TextField
                      fullWidth
                      value={editing.postalCode}
                      onChange={(value) => setEditing({ ...editing, postalCode: value })}
                    >
                      <Label>Postal code</Label>
                      <Input placeholder="110111" />
                    </TextField>
                    <TextField
                      fullWidth
                      value={editing.country}
                      onChange={(value) => setEditing({ ...editing, country: value })}
                    >
                      <Label>Country</Label>
                      <Input placeholder="Colombia" />
                    </TextField>
                  </div>

                  {editing.id && (
                    <Switch
                      isSelected={editing.active}
                      onChange={(value) => setEditing({ ...editing, active: value })}
                    >
                      <Switch.Content>
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                        Active
                      </Switch.Content>
                    </Switch>
                  )}
                  <p className="text-xs text-muted">
                    Deactivate to hide a location from new adjustments, or delete it from the
                    list to remove it along with its stock history.
                  </p>
                </div>
              ) : locations.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">
                  No locations yet. Add one to start tracking stock.
                </p>
              ) : (
                <div className="flex flex-col">
                  {locations.map((location) => (
                    <div
                      key={location.id}
                      className="flex items-center gap-3 border-b border-field-border py-3 last:border-b-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{location.name}</p>
                        <p className="truncate text-xs text-muted">
                          {[location.code, addressSummary(location.address)]
                            .filter(Boolean)
                            .join(" · ") || "No code"}
                        </p>
                      </div>
                      {location.is_default ? (
                        <Chip color="accent" size="sm" variant="soft">
                          Default
                        </Chip>
                      ) : (
                        <Button
                          isIconOnly
                          size="sm"
                          variant="tertiary"
                          isDisabled={saving}
                          aria-label={`Set ${location.name} as default`}
                          onPress={() => setDefault(location)}
                        >
                          <Star className="size-4 text-muted" />
                        </Button>
                      )}
                      {!location.active && (
                        <Chip size="sm" variant="soft">
                          Inactive
                        </Chip>
                      )}
                      <Button
                        isIconOnly
                        size="sm"
                        variant="tertiary"
                        aria-label={`Edit ${location.name}`}
                        onPress={() => setEditing(draftFromLocation(location))}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="tertiary"
                        isDisabled={saving}
                        aria-label={`Delete ${location.name}`}
                        onPress={() => remove(location)}
                      >
                        <TrashBin className="size-4 text-danger" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Modal.Body>

            <Modal.Footer>
              {editing ? (
                <>
                  <Button variant="secondary" isDisabled={saving} onPress={() => setEditing(null)}>
                    Back
                  </Button>
                  <Button
                    isDisabled={saving || !editing.name.trim()}
                    isPending={saving}
                    onPress={save}
                  >
                    Save location
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="secondary" onPress={() => onOpenChange(false)}>
                    Close
                  </Button>
                  <Button
                    onPress={() => setEditing({ ...EMPTY_LOCATION })}
                  >
                    <Plus className="size-4" />
                    New location
                  </Button>
                </>
              )}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
