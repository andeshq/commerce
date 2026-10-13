import { Button, Card } from "@heroui/react";
import { type ActionFunctionArgs, redirect, useFetcher } from "react-router";
import { COLLECTION_FORM_ID, CollectionForm, useCollectionForm } from "@/lib/collection-form";
import { type CollectionFormValues, collectionSchema } from "@/lib/collection-schema";
import { PageHeader } from "@/lib/page-header";
import { pgbase, pgbaseErrorMessages } from "@/lib/pgbase";
import { m } from "@/paraglide/messages.js";

export async function collectionNewAction({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const values = JSON.parse(String(formData.get("payload"))) as CollectionFormValues;

  const parsed = collectionSchema.safeParse(values);
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((issue) => issue.message) };
  }

  try {
    const existing = await pgbase.from("collections").select("id").throwOnError();
    await pgbase
      .from("collections")
      .insert({
        name: parsed.data.name,
        slug: parsed.data.slug,
        description: parsed.data.description.trim() || null,
        type: "manual",
        position: (existing.data ?? []).length,
      })
      .throwOnError();
    return redirect("/collections");
  } catch (error) {
    return { errors: pgbaseErrorMessages(error) };
  }
}

export function CollectionNew() {
  const fetcher = useFetcher<typeof collectionNewAction>();

  const submitting = fetcher.state !== "idle";
  const errors = fetcher.data?.errors ?? [];

  const form = useCollectionForm();
  const { isValid } = form.formState;

  function submit(values: CollectionFormValues) {
    const formData = new FormData();
    formData.set("payload", JSON.stringify(values));
    fetcher.submit(formData, { method: "post" });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={m.collections_new_title()}
        description={m.collections_description()}
        actions={
          <>
            <Button variant="secondary" isDisabled={submitting} onPress={() => history.back()}>
              {m.common_cancel()}
            </Button>
            <Button
              type="submit"
              form={COLLECTION_FORM_ID}
              isDisabled={submitting || !isValid}
              isPending={submitting}
            >
              {submitting ? m.common_saving() : m.collections_create()}
            </Button>
          </>
        }
      />

      <Card>
        <Card.Content>
          <CollectionForm form={form} errors={errors} onSubmit={submit} />
        </Card.Content>
      </Card>
    </div>
  );
}

/* React Router lazy-route contract. */
export { CollectionNew as Component, collectionNewAction as action };
