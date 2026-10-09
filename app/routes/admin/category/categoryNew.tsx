import { Button, Card } from "@heroui/react";
import { redirect, useFetcher, useLoaderData, type ActionFunctionArgs } from "react-router";
import { pgbase, pgbaseErrorMessages } from "@/lib/pgbase";
import { PageHeader } from "@/lib/page-header";
import { CATEGORY_FORM_ID, CategoryForm, useCategoryForm } from "@/lib/category-form";
import { categorySchema, NO_PARENT, type CategoryFormValues } from "@/lib/category-schema";
import { categoryPath, categoryTree, type Category } from "@/lib/catalog";

export async function categoryNewLoader() {
  const categories = await pgbase
    .from("categories")
    .select("id,parent_id,name,slug,description,position,created_at,updated_at")
    .order("position", { ascending: true })
    .throwOnError();

  return { categories: categories.data as Category[] };
}

export async function categoryNewAction({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const values = JSON.parse(String(formData.get("payload"))) as CategoryFormValues;

  const parsed = categorySchema.safeParse(values);
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((issue) => issue.message) };
  }

  const parentId = parsed.data.parentId === NO_PARENT ? null : parsed.data.parentId;

  try {
    const siblings = parentId
      ? await pgbase.from("categories").select("id").eq("parent_id", parentId).throwOnError()
      : await pgbase.from("categories").select("id").is("parent_id", null).throwOnError();

    await pgbase
      .from("categories")
      .insert({
        name: parsed.data.name,
        slug: parsed.data.slug,
        description: parsed.data.description.trim() || null,
        parent_id: parentId,
        position: (siblings.data ?? []).length,
      })
      .throwOnError();
    return redirect("/admin/categories");
  } catch (error) {
    return { errors: pgbaseErrorMessages(error) };
  }
}

export function CategoryNew() {
  const { categories } = useLoaderData<Awaited<ReturnType<typeof categoryNewLoader>>>();
  const fetcher = useFetcher<typeof categoryNewAction>();

  const submitting = fetcher.state !== "idle";
  const errors = fetcher.data?.errors ?? [];

  const form = useCategoryForm();
  const { isValid } = form.formState;

  const parentOptions = categoryTree(categories).map(({ category }) => ({
    id: category.id,
    label: categoryPath(categories, category.id),
  }));

  function submit(values: CategoryFormValues) {
    const formData = new FormData();
    formData.set("payload", JSON.stringify(values));
    fetcher.submit(formData, { method: "post" });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="New category"
        description="Group products for your storefront and reports."
        actions={
          <>
            <Button variant="secondary" isDisabled={submitting} onPress={() => history.back()}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={CATEGORY_FORM_ID}
              isDisabled={submitting || !isValid}
              isPending={submitting}
            >
              {submitting ? "Saving…" : "Create category"}
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
export { CategoryNew as Component, categoryNewLoader as loader, categoryNewAction as action };
