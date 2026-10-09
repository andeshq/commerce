import { Button, Card } from "@heroui/react";
import { redirect, useFetcher, useLoaderData, type ActionFunctionArgs } from "react-router";
import { pgbase, pgbaseErrorMessages } from "@/lib/pgbase";
import { PageHeader } from "@/lib/page-header";
import { OPTION_FORM_ID, OptionForm, useOptionForm } from "@/lib/option-form";
import { optionSchema, type OptionFormValues } from "@/lib/option-schema";
import type { OptionWithValues } from "@/lib/catalog";

export async function optionNewLoader() {
  const options = await pgbase
    .from("options")
    .select("id,name,position,created_at,updated_at,option_values(id,option_id,value,position)")
    .order("position", { ascending: true })
    .throwOnError();

  return { options: options.data as OptionWithValues[] };
}

/** One nested POST: the option plus its values. */
export async function optionNewAction({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const values = JSON.parse(String(formData.get("payload"))) as OptionFormValues;
  const count = Number(formData.get("count"));

  const parsed = optionSchema.safeParse(values);
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((issue) => issue.message) };
  }

  try {
    await pgbase
      .from("options")
      .insert({
        name: parsed.data.name,
        position: Number.isFinite(count) ? count : 0,
        option_values: parsed.data.values.map((row, position) => ({
          value: row.value,
          position,
        })),
      })
      .throwOnError();
    return redirect("/options");
  } catch (error) {
    return { errors: pgbaseErrorMessages(error) };
  }
}

export function OptionNew() {
  const { options } = useLoaderData<Awaited<ReturnType<typeof optionNewLoader>>>();
  const fetcher = useFetcher<typeof optionNewAction>();

  const submitting = fetcher.state !== "idle";
  const errors = fetcher.data?.errors ?? [];

  const form = useOptionForm();
  const { isValid } = form.formState;

  function submit(values: OptionFormValues) {
    const formData = new FormData();
    formData.set("payload", JSON.stringify(values));
    formData.set("count", String(options.length));
    fetcher.submit(formData, { method: "post" });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="New option"
        description="Define values once; any product can link this option."
        actions={
          <>
            <Button variant="secondary" isDisabled={submitting} onPress={() => history.back()}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={OPTION_FORM_ID}
              isDisabled={submitting || !isValid}
              isPending={submitting}
            >
              {submitting ? "Saving…" : "Create option"}
            </Button>
          </>
        }
      />

      <Card>
        <Card.Content>
          <OptionForm
            form={form}
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
export { OptionNew as Component, optionNewLoader as loader, optionNewAction as action };
