import { useState } from "react";
import { Button, Card } from "@heroui/react";
import {
  redirect,
  useFetcher,
  useLoaderData,
  useNavigate,
  type ActionFunctionArgs,
} from "react-router";
import { useAdminStore } from "@/routes/admin/adminLayout";
import { PRODUCT_FORM_ID, ProductForm, useProductForm } from "@/lib/product-form";
import { ProductImages } from "@/lib/product-images";
import { buildCreatePayload } from "@/lib/product-draft";
import { productFormSchema, type ProductFormValues } from "@/lib/product-schema";
import { pgbase, pgbaseErrorMessages } from "@/lib/pgbase";
import { PageHeader } from "@/lib/page-header";
import type { Category, ModifierGroupWithValues, OptionWithValues } from "@/lib/catalog";

export async function productNewLoader() {
  const [options, categories, modifiers] = await Promise.all([
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
  ]);

  return {
    options: options.data as OptionWithValues[],
    categories: categories.data as Category[],
    modifiers: modifiers.data as ModifierGroupWithValues[],
  };
}

/** One nested POST: product + option/modifier/image links + variants. */
export async function productNewAction({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const payload = JSON.parse(String(formData.get("payload"))) as {
    values: unknown;
    mediaIds: string[];
  };

  const parsed = productFormSchema.safeParse(payload.values);
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((issue) => issue.message) };
  }

  try {
    await pgbase
      .from("products")
      .insert(
        buildCreatePayload(
          parsed.data,
          parsed.data.optionIds,
          parsed.data.modifierGroupIds,
          payload.mediaIds,
          parsed.data.variants,
        ),
      )
      .throwOnError();
    return redirect("/products");
  } catch (error) {
    return { errors: pgbaseErrorMessages(error) };
  }
}

export function ProductNew() {
  const { options, categories, modifiers } =
    useLoaderData<Awaited<ReturnType<typeof productNewLoader>>>();
  const store = useAdminStore();
  const navigate = useNavigate();
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const fetcher = useFetcher<typeof productNewAction>();

  const submitting = fetcher.state !== "idle";
  const errors = fetcher.data?.errors ?? [];

  const form = useProductForm({});
  const { isValid } = form.formState;

  function submit(values: ProductFormValues) {
    const formData = new FormData();
    formData.set("payload", JSON.stringify({ values, mediaIds }));
    fetcher.submit(formData, { method: "post" });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="New product"
        description="Basics, options and variants are saved in one request."
        actions={
          <>
            <Button variant="secondary" isDisabled={submitting} onPress={() => navigate(-1)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={PRODUCT_FORM_ID}
              isDisabled={submitting || !isValid}
              isPending={submitting}
            >
              {submitting ? "Saving…" : "Create product"}
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
            images={<ProductImages onChange={setMediaIds} initialEntries={[]} />}
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
export { ProductNew as Component, productNewLoader as loader, productNewAction as action };
