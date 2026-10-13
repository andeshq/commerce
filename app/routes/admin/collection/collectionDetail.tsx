import { EllipsisVertical, TrashBin } from "@gravity-ui/icons";
import { Button, ButtonGroup, Card, Dropdown, Label } from "@heroui/react";
import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  redirect,
  useFetcher,
  useLoaderData,
} from "react-router";
import type { Collection, Product } from "@/lib/catalog";
import { COLLECTION_FORM_ID, CollectionForm, useCollectionForm } from "@/lib/collection-form";
import { type CollectionProduct, CollectionProducts } from "@/lib/collection-products";
import { type CollectionFormValues, collectionSchema } from "@/lib/collection-schema";
import { PageHeader } from "@/lib/page-header";
import { pgbase, pgbaseErrorMessages } from "@/lib/pgbase";
import { m } from "@/paraglide/messages.js";

export async function collectionDetailLoader({ params }: LoaderFunctionArgs) {
  const id = String(params.id);

  const [collection, products, links] = await Promise.all([
    pgbase
      .from("collections")
      .select("id,name,slug,description,type,position,created_at,updated_at")
      .eq("id", id)
      .maybeSingle()
      .throwOnError(),
    pgbase.from("products").select("id,title,slug").throwOnError(),
    pgbase
      .from("product_collections")
      .select("product_id,position")
      .eq("collection_id", id)
      .order("position", { ascending: true })
      .throwOnError(),
  ]);

  if (!collection.data) throw redirect("/collections");

  const all = (products.data ?? []) as Array<Pick<Product, "id" | "title" | "slug">>;
  const byId = new Map(all.map((product) => [product.id, product]));
  const linked = ((links.data ?? []) as Array<{ product_id: string }>)
    .map((link) => byId.get(link.product_id))
    .filter((product): product is CollectionProduct => Boolean(product));

  return { collection: collection.data as Collection, linked, products: all };
}

export async function collectionDetailAction({ request, params }: ActionFunctionArgs) {
  const collectionId = String(params.id);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "update") {
    const values = JSON.parse(String(formData.get("payload"))) as CollectionFormValues;
    const parsed = collectionSchema.safeParse(values);
    if (!parsed.success) {
      return { errors: parsed.error.issues.map((issue) => issue.message) };
    }

    try {
      await pgbase
        .from("collections")
        .update({
          name: parsed.data.name,
          slug: parsed.data.slug,
          description: parsed.data.description.trim() || null,
        })
        .eq("id", collectionId)
        .throwOnError();
      return redirect("/collections");
    } catch (error) {
      return { errors: pgbaseErrorMessages(error) };
    }
  }

  if (intent === "delete") {
    try {
      await pgbase.from("collections").delete().eq("id", collectionId).throwOnError();
      return redirect("/collections");
    } catch (error) {
      return { errors: pgbaseErrorMessages(error) };
    }
  }

  return { errors: [m.common_unknown_action()] };
}

export function CollectionDetail() {
  const { collection, linked, products } =
    useLoaderData<Awaited<ReturnType<typeof collectionDetailLoader>>>();
  const fetcher = useFetcher<typeof collectionDetailAction>();

  const submitting = fetcher.state !== "idle";
  const errors = fetcher.data?.errors ?? [];

  const form = useCollectionForm({
    initial: {
      name: collection.name,
      slug: collection.slug,
      description: collection.description ?? "",
    },
  });
  const { isValid } = form.formState;

  function submit(values: CollectionFormValues) {
    const formData = new FormData();
    formData.set("intent", "update");
    formData.set("payload", JSON.stringify(values));
    fetcher.submit(formData, { method: "post" });
  }

  function remove() {
    if (!window.confirm(m.collections_delete_confirm({ name: collection.name }))) return;
    const formData = new FormData();
    formData.set("intent", "delete");
    fetcher.submit(formData, { method: "post" });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={m.collections_edit_title()}
        description={collection.name}
        actions={
          <>
            <Button variant="secondary" isDisabled={submitting} onPress={() => history.back()}>
              {m.common_cancel()}
            </Button>
            <ButtonGroup>
              <Button
                type="submit"
                form={COLLECTION_FORM_ID}
                isDisabled={submitting || !isValid}
                isPending={submitting}
              >
                {submitting ? m.common_saving() : m.common_save()}
              </Button>
              <Dropdown>
                <Button isIconOnly aria-label={m.common_more_actions()} isDisabled={submitting}>
                  <ButtonGroup.Separator />
                  <EllipsisVertical className="size-4" />
                </Button>
                <Dropdown.Popover placement="bottom end">
                  <Dropdown.Menu
                    onAction={(key) => {
                      if (key === "delete") void remove();
                    }}
                  >
                    <Dropdown.Item id="delete" textValue={m.collections_delete()} variant="danger">
                      <TrashBin className="size-4 shrink-0 text-danger" />
                      <Label>{m.collections_delete()}</Label>
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            </ButtonGroup>
          </>
        }
      />

      <Card>
        <Card.Content>
          <CollectionForm form={form} errors={errors} onSubmit={submit} />
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <h3 className="text-sm font-semibold">{m.collections_products()}</h3>
        </Card.Header>
        <Card.Content>
          <CollectionProducts
            collectionId={collection.id}
            initialEntries={linked}
            available={products}
          />
        </Card.Content>
      </Card>
    </div>
  );
}

/* React Router lazy-route contract. */
export {
  CollectionDetail as Component,
  collectionDetailAction as action,
  collectionDetailLoader as loader,
};
