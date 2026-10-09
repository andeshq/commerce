import { Button, Card } from "@heroui/react";
import { redirect, useFetcher, useLoaderData, type ActionFunctionArgs } from "react-router";
import { useAdminStore } from "@/routes/admin/adminLayout";
import { pgbase, pgbaseErrorMessages } from "@/lib/pgbase";
import { PageHeader } from "@/lib/page-header";
import { MODIFIER_FORM_ID, ModifierForm, useModifierForm } from "@/lib/modifier-form";
import { modifierSchema, type ModifierFormValues } from "@/lib/modifier-schema";
import { currencySymbol, toCents } from "@/lib/catalog";

export async function modifierNewLoader() {
  const modifiers = await pgbase.from("modifier_groups").select("id").throwOnError();
  return { count: (modifiers.data ?? []).length };
}

/** One nested POST: the group plus its priced values. */
export async function modifierNewAction({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const values = JSON.parse(String(formData.get("payload"))) as ModifierFormValues;
  const count = Number(formData.get("count"));

  const parsed = modifierSchema.safeParse(values);
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((issue) => issue.message) };
  }

  try {
    await pgbase
      .from("modifier_groups")
      .insert({
        name: parsed.data.name,
        selection_type: parsed.data.selectionType,
        required: parsed.data.required,
        position: Number.isFinite(count) ? count : 0,
        modifier_values: parsed.data.values.map((row, position) => ({
          name: row.name,
          price_delta_cents: toCents(row.price) ?? 0,
          position,
        })),
      })
      .throwOnError();
    return redirect("/modifiers");
  } catch (error) {
    return { errors: pgbaseErrorMessages(error) };
  }
}

export function ModifierNew() {
  const { count } = useLoaderData<Awaited<ReturnType<typeof modifierNewLoader>>>();
  const store = useAdminStore();
  const fetcher = useFetcher<typeof modifierNewAction>();

  const submitting = fetcher.state !== "idle";
  const errors = fetcher.data?.errors ?? [];

  const form = useModifierForm();
  const { isValid } = form.formState;
  const symbol = currencySymbol(store?.currency_code ?? "COP", store?.locale ?? "es-CO");

  function submit(values: ModifierFormValues) {
    const formData = new FormData();
    formData.set("payload", JSON.stringify(values));
    formData.set("count", String(count));
    fetcher.submit(formData, { method: "post" });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="New modifier"
        description="Priced add-ons customers can pick at checkout."
        actions={
          <>
            <Button variant="secondary" isDisabled={submitting} onPress={() => history.back()}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={MODIFIER_FORM_ID}
              isDisabled={submitting || !isValid}
              isPending={submitting}
            >
              {submitting ? "Saving…" : "Create modifier"}
            </Button>
          </>
        }
      />

      <Card>
        <Card.Content>
          <ModifierForm
            form={form}
            symbol={symbol}
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
export { ModifierNew as Component, modifierNewLoader as loader, modifierNewAction as action };
