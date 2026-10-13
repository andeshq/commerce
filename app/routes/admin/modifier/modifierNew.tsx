import { Button, Card } from "@heroui/react";
import { type ActionFunctionArgs, redirect, useFetcher, useLoaderData } from "react-router";
import { currencySymbol, toCents } from "@/lib/catalog";
import { MODIFIER_FORM_ID, ModifierForm, useModifierForm } from "@/lib/modifier-form";
import { type ModifierFormValues, modifierSchema } from "@/lib/modifier-schema";
import { PageHeader } from "@/lib/page-header";
import { pgbase, pgbaseErrorMessages } from "@/lib/pgbase";
import { m } from "@/paraglide/messages.js";
import { useAdminStore } from "@/routes/admin/adminLayout";

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
        title={m.modifiers_new_title()}
        description={m.modifiers_description()}
        actions={
          <>
            <Button variant="secondary" isDisabled={submitting} onPress={() => history.back()}>
              {m.common_cancel()}
            </Button>
            <Button
              type="submit"
              form={MODIFIER_FORM_ID}
              isDisabled={submitting || !isValid}
              isPending={submitting}
            >
              {submitting ? m.common_saving() : m.modifiers_create()}
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
export { ModifierNew as Component, modifierNewAction as action, modifierNewLoader as loader };
