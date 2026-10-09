import { useState } from "react";
import { Button, Card, Dropdown, Label } from "@heroui/react";
import { ChevronDown, Copy, Picture, TrashBin } from "@gravity-ui/icons";
import {
  redirect,
  useFetcher,
  useLoaderData,
  useRevalidator,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { useAdminStore } from "@/routes/admin/adminLayout";
import { pgbase, pgbaseErrorMessages } from "@/lib/pgbase";
import { PageHeader } from "@/lib/page-header";
import { PRODUCT_FORM_ID, ProductForm, useProductForm } from "@/lib/product-form";
import { ProductImages } from "@/lib/product-images";
import { AdjustStockDialog } from "@/lib/inventory-dialogs";
import { levelFor, type InventoryItemRow } from "@/lib/inventory";
import {
  buildUpdatePayload,
  computeRemovals,
  draftFromVariant,
} from "@/lib/product-draft";
import { duplicateProduct } from "@/lib/product-duplicate";
import { NO_CATEGORY, productFormSchema, type ProductFormValues, type VariantDraft } from "@/lib/product-schema";
import type {
  Category,
  InventoryLevel,
  InventoryLocation,
  Media,
  ModifierGroupWithValues,
  OptionWithValues,
  Product,
  ProductMediaLink,
  ProductModifierLink,
  ProductOptionLink,
  VariantMediaLink,
  VariantWithLinks,
} from "@/lib/catalog";

export async function productDetailLoader({ params }: LoaderFunctionArgs) {
  const id = String(params.id);

  const [
    product,
    variants,
    links,
    options,
    categories,
    modifiers,
    modifierLinks,
    media,
    productMedia,
    variantMedia,
    inventory,
    locations,
  ] = await Promise.all([
    pgbase.from("products").select("*").eq("id", id).maybeSingle().throwOnError(),
    pgbase
      .from("catalog_variants")
      .select("*,variant_option_values(option_value_id),product_variant_costs(cost_cents)")
      .eq("product_id", id)
      .order("position", { ascending: true })
      .throwOnError(),
    pgbase.from("product_options").select("option_id,position").eq("product_id", id).throwOnError(),
    pgbase
      .from("options")
      .select("id,name,position,created_at,updated_at,option_values(id,option_id,value,position)")
      .order("position", { ascending: true })
      .throwOnError(),
    pgbase
      .from("categories")
      .select("id,parent_id,name,slug,description,position,created_at,updated_at")
      .order("position", { ascending: true })
      .throwOnError(),
    pgbase
      .from("modifier_groups")
      .select(
        "id,name,selection_type,required,position,created_at,updated_at,modifier_values(id,group_id,name,price_delta_cents::text,position)",
      )
      .order("position", { ascending: true })
      .throwOnError(),
    pgbase
      .from("product_modifier_groups")
      .select("product_id,group_id,position")
      .eq("product_id", id)
      .throwOnError(),
    pgbase.from("media").select("id,url,alt,width,height").throwOnError(),
    pgbase
      .from("product_media")
      .select("product_id,media_id,position")
      .eq("product_id", id)
      .order("position", { ascending: true })
      .throwOnError(),
    pgbase.from("variant_media").select("variant_id,media_id").throwOnError(),
    pgbase.from("inventory_levels").select("variant_id,location_id,available,updated_at").throwOnError(),
    pgbase
      .from("inventory_locations")
      .select("id,name,code,address,active,is_default")
      .order("name", { ascending: true })
      .throwOnError(),
  ]);

  if (!product.data) throw redirect("/admin/products");

  return {
    product: product.data as Product,
    variants: variants.data as VariantWithLinks[],
    links: links.data as ProductOptionLink[],
    options: options.data as OptionWithValues[],
    categories: categories.data as Category[],
    modifiers: modifiers.data as ModifierGroupWithValues[],
    modifierLinks: modifierLinks.data as ProductModifierLink[],
    media: media.data as Media[],
    productMedia: productMedia.data as ProductMediaLink[],
    variantMedia: variantMedia.data as VariantMediaLink[],
    inventory: inventory.data as InventoryLevel[],
    locations: locations.data as InventoryLocation[],
  };
}

export async function productDetailAction({ request, params }: ActionFunctionArgs) {
  const productId = String(params.id);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "update") {
    const values = JSON.parse(String(formData.get("payload"))) as unknown;
    const parsed = productFormSchema.safeParse(values);
    if (!parsed.success) {
      return { errors: parsed.error.issues.map((issue) => issue.message) };
    }

    try {
      // Nested PATCH upserts the graph; nested writes never delete, so rows the
      // form dropped are removed with explicit DELETEs afterwards.
      await pgbase
        .from("products")
        .update(
          buildUpdatePayload(
            parsed.data,
            parsed.data.optionIds,
            parsed.data.modifierGroupIds,
            parsed.data.variants,
          ),
        )
        .eq("id", productId)
        .throwOnError();

      const [variants, optionLinks, modifierLinks] = await Promise.all([
        pgbase
          .from("product_variants")
          .select("id,variant_option_values(option_value_id)")
          .eq("product_id", productId)
          .throwOnError(),
        pgbase.from("product_options").select("option_id").eq("product_id", productId).throwOnError(),
        pgbase
          .from("product_modifier_groups")
          .select("group_id")
          .eq("product_id", productId)
          .throwOnError(),
      ]);

      const removals = computeRemovals(
        productId,
        {
          variants: variants.data as VariantWithLinks[],
          optionIds: (optionLinks.data as Array<{ option_id: string }>).map(
            (link) => link.option_id,
          ),
          modifierIds: (modifierLinks.data as Array<{ group_id: string }>).map(
            (link) => link.group_id,
          ),
        },
        parsed.data.optionIds,
        parsed.data.modifierGroupIds,
        parsed.data.variants,
      );
      for (const removal of removals) {
        let query = pgbase.from(removal.table).delete();
        for (const [column, value] of removal.filters) query = query.eq(column, value);
        await query.throwOnError();
      }

      return redirect("/admin/products");
    } catch (error) {
      return { errors: pgbaseErrorMessages(error) };
    }
  }

  if (intent === "delete") {
    try {
      await pgbase.from("products").delete().eq("id", productId).throwOnError();
      return redirect("/admin/products");
    } catch (error) {
      return { errors: pgbaseErrorMessages(error) };
    }
  }

  if (intent === "duplicate") {
    try {
      const newId = await duplicateProduct(productId);
      return redirect(`/admin/products/${newId}`);
    } catch (error) {
      return { errors: pgbaseErrorMessages(error) };
    }
  }

  return { errors: ["Unknown action."] };
}

export function ProductDetail() {
  const data = useLoaderData<Awaited<ReturnType<typeof productDetailLoader>>>();

  // Keyed so navigating between two products remounts the form and local state.
  return <ProductEditor key={data.product.id} data={data} />;
}

type ProductDetailData = Awaited<ReturnType<typeof productDetailLoader>>;

function ProductEditor({ data }: { data: ProductDetailData }) {
  const {
    product,
    variants,
    links,
    options,
    categories,
    modifiers,
    modifierLinks,
    media,
    productMedia,
    variantMedia: variantMediaLinks,
    inventory,
    locations,
  } = data;
  const store = useAdminStore();
  const revalidator = useRevalidator();
  const fetcher = useFetcher<typeof productDetailAction>();
  const [actionError, setActionError] = useState<string | null>(null);
  const [adjust, setAdjust] = useState<{
    open: boolean;
    variantId?: string;
    locationId?: string;
  }>({ open: false });

  const submitting = fetcher.state !== "idle";
  const errors = [...(fetcher.data?.errors ?? []), ...(actionError ? [actionError] : [])];

  const variantMedia = new Map(
    variantMediaLinks.map((link) => [link.variant_id, link.media_id]),
  );
  const activeLocations = locations.filter((location) => location.active);
  const stockItems: InventoryItemRow[] = variants.map((variant) => ({
    variantId: variant.id,
    productId: product.id,
    productTitle: product.title,
    variantTitle: variant.title,
    sku: variant.sku,
  }));

  const form = useProductForm({
    initial: {
      title: product.title,
      slug: product.slug,
      status: product.status,
      vendor: product.vendor ?? "",
      productType: product.product_type ?? "",
      categoryId: product.category_id ?? NO_CATEGORY,
      description: product.description ?? "",
    },
    optionIds: links.map((link) => link.option_id),
    modifierIds: modifierLinks.map((link) => link.group_id),
    variants: variants.map(draftFromVariant),
  });
  const { isValid } = form.formState;

  const mediaById = new Map(media.map((item) => [item.id, item]));
  const imageEntries = [...productMedia]
    .sort((a, b) => a.position - b.position)
    .flatMap((link) => {
      const item = mediaById.get(link.media_id);
      return item ? [{ mediaId: item.id, url: item.url, alt: item.alt }] : [];
    });

  /** Variant images are written immediately, like product images. */
  async function setVariantImage(variantId: string, mediaId: string | null) {
    setActionError(null);
    try {
      await pgbase.from("variant_media").delete().eq("variant_id", variantId).throwOnError();
      if (mediaId) {
        await pgbase
          .from("variant_media")
          .insert({ variant_id: variantId, media_id: mediaId, position: 0 })
          .throwOnError();
      }
      await revalidator.revalidate();
    } catch (error) {
      setActionError(pgbaseErrorMessages(error)[0] ?? "Could not set the variant image.");
    }
  }

  /** Detaching an image from the product clears any variant that used it. */
  async function handleDetachedImage(mediaId: string) {
    const affected = variantMediaLinks
      .filter((link) => link.media_id === mediaId)
      .map((link) => link.variant_id);
    if (affected.length === 0) return;

    setActionError(null);
    try {
      await pgbase
        .from("variant_media")
        .delete()
        .in("variant_id", affected)
        .eq("media_id", mediaId)
        .throwOnError();
      await revalidator.revalidate();
    } catch (error) {
      setActionError(pgbaseErrorMessages(error)[0] ?? "Could not clear the variant image.");
    }
  }

  function renderVariantImage(variant: VariantDraft, index: number) {
    const selectedId = variant.id ? (variantMedia.get(variant.id) ?? "") : "";
    const selected = imageEntries.find((entry) => entry.mediaId === selectedId);

    return (
      <Dropdown>
        <Button
          isIconOnly
          size="sm"
          variant="tertiary"
          isDisabled={!variant.id || imageEntries.length === 0}
          aria-label={`Image for variant ${index + 1} (${variant.title})`}
        >
          {selected ? (
            <img src={selected.url} alt="" className="size-6 rounded object-cover" />
          ) : (
            <Picture className="size-4 text-muted" />
          )}
        </Button>
        <Dropdown.Popover>
          <Dropdown.Menu
            selectedKeys={[selectedId || "none"]}
            selectionMode="single"
            onSelectionChange={(keys) => {
              const [key] = [...keys];
              if (typeof key !== "string" || !variant.id) return;
              void setVariantImage(variant.id, key === "none" ? null : key);
            }}
          >
            <Dropdown.Item id="none" textValue="No image">
              <Label>No image</Label>
              <Dropdown.ItemIndicator />
            </Dropdown.Item>
            {imageEntries.map((entry) => (
              <Dropdown.Item
                key={entry.mediaId}
                id={entry.mediaId}
                textValue={entry.alt ?? "Image"}
              >
                <img src={entry.url} alt="" className="size-6 rounded object-cover" />
                <Label>{entry.alt ?? "Image"}</Label>
                <Dropdown.ItemIndicator />
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    );
  }

  function submit(values: ProductFormValues) {
    setActionError(null);
    const formData = new FormData();
    formData.set("intent", "update");
    formData.set("payload", JSON.stringify(values));
    fetcher.submit(formData, { method: "post" });
  }

  function remove() {
    if (!window.confirm(`Delete "${product.title}"?`)) return;
    const formData = new FormData();
    formData.set("intent", "delete");
    fetcher.submit(formData, { method: "post" });
  }

  function duplicate() {
    setActionError(null);
    const formData = new FormData();
    formData.set("intent", "duplicate");
    fetcher.submit(formData, { method: "post" });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Edit product"
        description={`${product.title} · /${product.slug}`}
        actions={
          <>
            <Dropdown>
              <Button variant="secondary" isDisabled={submitting}>
                Actions
                <ChevronDown className="size-4 text-muted" />
              </Button>
              <Dropdown.Popover>
                <Dropdown.Menu
                  onAction={(key) => {
                    if (key === "duplicate") duplicate();
                    if (key === "delete") remove();
                  }}
                >
                  <Dropdown.Item id="duplicate" textValue="Duplicate product">
                    <Copy className="size-4 shrink-0 text-muted" />
                    <Label>Duplicate product</Label>
                  </Dropdown.Item>
                  <Dropdown.Item id="delete" textValue="Delete product" variant="danger">
                    <TrashBin className="size-4 shrink-0 text-danger" />
                    <Label>Delete product</Label>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
            <Button variant="secondary" isDisabled={submitting} onPress={() => history.back()}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={PRODUCT_FORM_ID}
              isDisabled={submitting || !isValid}
              isPending={submitting}
            >
              {submitting ? "Saving…" : "Save changes"}
            </Button>
          </>
        }
      />

      <Card>
        <Card.Content>
          <ProductForm
            form={form}
            options={options}
            categories={categories}
            modifiers={modifiers}
            currency={store?.currency_code ?? "COP"}
            locale={store?.locale ?? "es-CO"}
            images={
              <ProductImages
                productId={product.id}
                initialEntries={imageEntries}
                onDetached={(mediaId) => void handleDetachedImage(mediaId)}
              />
            }
            variantImage={renderVariantImage}
            submitting={submitting}
            errors={errors}
            onSubmit={submit}
          />
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>Stock</Card.Title>
          <Card.Description>
            On hand by location. Adjustments are recorded immediately.
          </Card.Description>
        </Card.Header>
        <Card.Content>
          {variants.length === 0 ? (
            <p className="text-sm text-muted">No variants yet.</p>
          ) : activeLocations.length === 0 ? (
            <p className="text-sm text-muted">
              No active locations. Add one from the Inventory page.
            </p>
          ) : (
            <div className="flex flex-col">
              {variants.map((variant) => (
                <div
                  key={variant.id}
                  className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-field-border py-3 first:pt-0 last:border-b-0 last:pb-0"
                >
                  <div className="min-w-40 flex-1">
                    <p className="truncate text-sm font-medium">{variant.title}</p>
                    <p className="truncate text-xs text-muted">{variant.sku ?? "No SKU"}</p>
                  </div>
                  {activeLocations.map((location) => (
                    <div key={location.id} className="flex items-center gap-2">
                      <span className="text-xs text-muted">{location.name}</span>
                      <span className="w-8 text-end text-sm tabular-nums">
                        {levelFor(inventory, variant.id, location.id)}
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={`Adjust stock for ${variant.title} at ${location.name}`}
                        onPress={() =>
                          setAdjust({ open: true, variantId: variant.id, locationId: location.id })
                        }
                      >
                        Adjust
                      </Button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Card.Content>
      </Card>

      <AdjustStockDialog
        open={adjust.open}
        onOpenChange={(open) => setAdjust((current) => ({ ...current, open }))}
        items={stockItems}
        locations={activeLocations}
        levels={inventory}
        initial={{ variantId: adjust.variantId, locationId: adjust.locationId }}
        onAdjusted={() => void revalidator.revalidate()}
      />
    </div>
  );
}

/* React Router lazy-route contract. */
export { ProductDetail as Component, productDetailLoader as loader, productDetailAction as action };
