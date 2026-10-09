import { Button, Card, Dropdown, Label } from "@heroui/react";
import { ChevronDown, TrashBin } from "@gravity-ui/icons";
import {
  redirect,
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { pgbase, pgbaseErrorMessages } from "@/lib/pgbase";
import { PageHeader } from "@/lib/page-header";
import { CATEGORY_FORM_ID, CategoryForm, useCategoryForm } from "@/lib/category-form";
import { categorySchema, NO_PARENT, type CategoryFormValues } from "@/lib/category-schema";
import { categoryDescendantIds, categoryPath, categoryTree, type Category } from "@/lib/catalog";

export async function categoryDetailLoader({ params }: LoaderFunctionArgs) {
  const id = String(params.id);

  const [category, categories, usage] = await Promise.all([
    pgbase
      .from("categories")
      .select("id,parent_id,name,slug,description,position,created_at,updated_at")
      .eq("id", id)
      .maybeSingle()
      .throwOnError(),
    pgbase
      .from("categories")
      .select("id,parent_id,name,slug,description,position,created_at,updated_at")
      .order("position", { ascending: true })
      .throwOnError(),
    pgbase.from("products").select("id").eq("category_id", id).throwOnError(),
  ]);

  if (!category.data) throw redirect("/admin/categories");

  return {
    category: category.data as Category,
    categories: categories.data as Category[],
    productCount: (usage.data ?? []).length,
  };
}

export async function categoryDetailAction({ request, params }: ActionFunctionArgs) {
  const categoryId = String(params.id);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "update") {
    const values = JSON.parse(String(formData.get("payload"))) as CategoryFormValues;
    const parsed = categorySchema.safeParse(values);
    if (!parsed.success) {
      return { errors: parsed.error.issues.map((issue) => issue.message) };
    }

    try {
      await pgbase
        .from("categories")
        .update({
          name: parsed.data.name,
          slug: parsed.data.slug,
          description: parsed.data.description.trim() || null,
          parent_id: parsed.data.parentId === NO_PARENT ? null : parsed.data.parentId,
        })
        .eq("id", categoryId)
        .throwOnError();
      return redirect("/admin/categories");
    } catch (error) {
      return { errors: pgbaseErrorMessages(error) };
    }
  }

  if (intent === "delete") {
    try {
      await pgbase.from("categories").delete().eq("id", categoryId).throwOnError();
      return redirect("/admin/categories");
    } catch (error) {
      return { errors: pgbaseErrorMessages(error) };
    }
  }

  return { errors: ["Unknown action."] };
}

export function CategoryDetail() {
  const { category, categories, productCount } =
    useLoaderData<Awaited<ReturnType<typeof categoryDetailLoader>>>();
  const fetcher = useFetcher<typeof categoryDetailAction>();

  const submitting = fetcher.state !== "idle";
  const errors = fetcher.data?.errors ?? [];

  const form = useCategoryForm({
    initial: {
      name: category.name,
      slug: category.slug,
      parentId: category.parent_id ?? NO_PARENT,
      description: category.description ?? "",
    },
  });
  const { isValid } = form.formState;

  // A category cannot be its own parent, nor move under one of its descendants.
  const excluded = categoryDescendantIds(categories, category.id);
  const parentOptions = categoryTree(categories)
    .filter(({ category: option }) => !excluded.has(option.id))
    .map(({ category: option }) => ({
      id: option.id,
      label: categoryPath(categories, option.id),
    }));

  function submit(values: CategoryFormValues) {
    const formData = new FormData();
    formData.set("intent", "update");
    formData.set("payload", JSON.stringify(values));
    fetcher.submit(formData, { method: "post" });
  }

  function remove() {
    if (
      !window.confirm(
        `Delete category “${category.name}”? Products keep existing, they just lose this category.`,
      )
    ) {
      return;
    }
    const formData = new FormData();
    formData.set("intent", "delete");
    fetcher.submit(formData, { method: "post" });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Edit category"
        description={`${category.name} · ${productCount} ${
          productCount === 1 ? "product" : "products"
        }`}
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
                    if (key === "delete") void remove();
                  }}
                >
                  <Dropdown.Item id="delete" textValue="Delete category" variant="danger">
                    <TrashBin className="size-4 shrink-0 text-danger" />
                    <Label>Delete category</Label>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
            <Button variant="secondary" isDisabled={submitting} onPress={() => history.back()}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={CATEGORY_FORM_ID}
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
          <CategoryForm
            form={form}
            parentOptions={parentOptions}
            submitting={submitting}
            errors={errors}
            onSubmit={submit}
          />
        </Card.Content>
      </Card>
    </div>
  );
}

/* React Router lazy-route contract. */
export { CategoryDetail as Component, categoryDetailLoader as loader, categoryDetailAction as action };
