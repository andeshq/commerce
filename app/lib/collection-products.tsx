import { Plus, Xmark } from "@gravity-ui/icons";
import { Button, Label, ListBox, Select } from "@heroui/react";
import { useState } from "react";
import { m } from "@/paraglide/messages.js";
import { pgbase, pgbaseErrorMessages } from "./pgbase";

export interface CollectionProduct {
  id: string;
  title: string;
  slug: string;
}

/** Writes 0..n-1 to the collection's product links, keeping their order. */
async function renumber(collectionId: string, entries: CollectionProduct[]) {
  for (const [position, item] of entries.entries()) {
    await pgbase
      .from("product_collections")
      .update({ position })
      .eq("collection_id", collectionId)
      .eq("product_id", item.id)
      .throwOnError();
  }
}

/**
 * Manual curation of a collection. Links are written immediately (like the
 * image library) because the collection already exists on this page.
 */
export function CollectionProducts({
  collectionId,
  initialEntries,
  available,
}: {
  collectionId: string;
  initialEntries: CollectionProduct[];
  available: CollectionProduct[];
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState("");

  const linked = new Set(entries.map((entry) => entry.id));
  const options = available.filter((product) => !linked.has(product.id));

  async function add(productId: string) {
    const product = available.find((item) => item.id === productId);
    if (!product) return;

    setBusy(true);
    setError(null);
    try {
      await pgbase
        .from("product_collections")
        .insert({
          product_id: productId,
          collection_id: collectionId,
          position: entries.length,
        })
        .throwOnError();
      setEntries([...entries, product]);
      setPick("");
    } catch (caught) {
      setError(pgbaseErrorMessages(caught)[0] ?? m.common_something_wrong());
    } finally {
      setBusy(false);
    }
  }

  async function remove(productId: string) {
    const next = entries.filter((entry) => entry.id !== productId);
    setBusy(true);
    setError(null);
    try {
      await pgbase
        .from("product_collections")
        .delete()
        .eq("collection_id", collectionId)
        .eq("product_id", productId)
        .throwOnError();
      await renumber(collectionId, next);
      setEntries(next);
    } catch (caught) {
      setError(pgbaseErrorMessages(caught)[0] ?? m.common_something_wrong());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Select
          className="w-64"
          isDisabled={busy || options.length === 0}
          placeholder={m.collections_add_products()}
          value={pick}
          onChange={(value) => void add(String(value))}
        >
          <Label>{m.collections_add_products()}</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {options.map((product) => (
                <ListBox.Item key={product.id} id={product.id} textValue={product.title}>
                  {product.title}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        <Plus className="size-4 text-muted" aria-hidden />
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-muted">{m.collections_no_products()}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-field-border rounded-2xl border border-field-border">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-sm font-medium">{entry.title}</span>
              <Button
                aria-label={m.collections_remove_product({ title: entry.title })}
                isIconOnly
                size="sm"
                variant="tertiary"
                isDisabled={busy}
                onPress={() => void remove(entry.id)}
              >
                <Xmark className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
