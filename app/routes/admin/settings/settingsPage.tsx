import { Button, Card } from "@heroui/react";
import { useFetcher, type ActionFunctionArgs } from "react-router";
import { useAdminStore } from "@/routes/admin/adminLayout";
import { useAuth } from "@/lib/auth-context";
import { pgbase, pgbaseErrorMessages } from "@/lib/pgbase";
import { PageHeader } from "@/lib/page-header";
import { STORE_FORM_ID, StoreForm, useStoreForm } from "@/lib/store-form";
import { storeSchema, type StoreFormValues } from "@/lib/store-schema";
import { PaymentsCard } from "@/lib/payments-card";

/** RLS only lets admins write here; staff see the form disabled. */
export async function settingsAction({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const values = JSON.parse(String(formData.get("payload"))) as StoreFormValues;

  const parsed = storeSchema.safeParse(values);
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((issue) => issue.message) };
  }

  try {
    await pgbase
      .from("store_settings")
      .update({
        name: parsed.data.name,
        currency_code: parsed.data.currencyCode,
        locale: parsed.data.locale,
        tax_label: parsed.data.taxLabel,
        tax_rate_bps: Math.round(Number(parsed.data.taxRate) * 100),
        prices_include_tax: parsed.data.pricesIncludeTax,
      })
      .eq("id", true)
      .throwOnError();
    return { errors: [] as string[] };
  } catch (error) {
    return { errors: pgbaseErrorMessages(error) };
  }
}

export function SettingsPage() {
  const store = useAdminStore();

  // Keyed so a successful save (which revalidates the admin layout) remounts
  // the form with the persisted values.
  const key = store
    ? `${store.name}|${store.currency_code}|${store.locale}|${store.prices_include_tax}|${store.tax_rate_bps}|${store.tax_label}`
    : "empty";

  return <SettingsForm key={key} />;
}

function SettingsForm() {
  const store = useAdminStore();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const fetcher = useFetcher<typeof settingsAction>();

  const submitting = fetcher.state !== "idle";
  const errors = fetcher.data?.errors ?? [];

  const form = useStoreForm({ initial: store ?? undefined });
  const { isValid } = form.formState;

  function submit(values: StoreFormValues) {
    const formData = new FormData();
    formData.set("payload", JSON.stringify(values));
    fetcher.submit(formData, { method: "post" });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Store settings"
        description={
          isAdmin
            ? "Name, currency and tax display for this store."
            : "Name, currency and tax display for this store (admins only)."
        }
        actions={
          <>
            <Button variant="secondary" isDisabled={submitting} onPress={() => history.back()}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={STORE_FORM_ID}
              isDisabled={!isAdmin || submitting || !isValid}
              isPending={submitting}
            >
              {submitting ? "Saving…" : "Save changes"}
            </Button>
          </>
        }
      />

      <Card>
        <Card.Content>
          <StoreForm
            form={form}
            isDisabled={!isAdmin}
            submitting={submitting}
            errors={errors}
            onSubmit={submit}
          />
        </Card.Content>
      </Card>

      <PaymentsCard />
    </div>
  );
}

/* React Router lazy-route contract. */
export { SettingsPage as Component, settingsAction as action };
