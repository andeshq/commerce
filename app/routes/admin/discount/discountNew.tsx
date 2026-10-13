import { Button, Card } from "@heroui/react";
import { type ActionFunctionArgs, redirect, useFetcher } from "react-router";
import { DISCOUNT_FORM_ID, DiscountForm, useDiscountForm } from "@/lib/discount-form";
import { type DiscountFormValues, discountPayload, discountSchema } from "@/lib/discount-schema";
import { PageHeader } from "@/lib/page-header";
import { pgbase, pgbaseErrorMessages } from "@/lib/pgbase";
import { m } from "@/paraglide/messages.js";
import { useAdminStore } from "@/routes/admin/adminLayout";

export async function discountNewAction({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const values = JSON.parse(String(formData.get("payload"))) as DiscountFormValues;

  const parsed = discountSchema.safeParse(values);
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((issue) => issue.message) };
  }

  const payload = discountPayload(parsed.data);
  if (!payload.ok) return { errors: payload.errors };

  try {
    await pgbase.from("discounts").insert(payload.data).throwOnError();
    return redirect("/discounts");
  } catch (error) {
    return { errors: pgbaseErrorMessages(error) };
  }
}

export function DiscountNew() {
  const store = useAdminStore();
  const fetcher = useFetcher<typeof discountNewAction>();

  const submitting = fetcher.state !== "idle";
  const errors = fetcher.data?.errors ?? [];

  const form = useDiscountForm();
  const { isValid } = form.formState;

  function submit(values: DiscountFormValues) {
    const formData = new FormData();
    formData.set("payload", JSON.stringify(values));
    fetcher.submit(formData, { method: "post" });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={m.discounts_new_title()}
        description={m.discounts_description()}
        actions={
          <>
            <Button variant="secondary" isDisabled={submitting} onPress={() => history.back()}>
              {m.common_cancel()}
            </Button>
            <Button
              type="submit"
              form={DISCOUNT_FORM_ID}
              isDisabled={submitting || !isValid}
              isPending={submitting}
            >
              {submitting ? m.common_saving() : m.discounts_create()}
            </Button>
          </>
        }
      />

      <Card>
        <Card.Content>
          <DiscountForm
            form={form}
            currency={store?.currency_code ?? "USD"}
            locale={store?.locale ?? "en"}
            errors={errors}
            onSubmit={submit}
          />
        </Card.Content>
      </Card>
    </div>
  );
}

/* React Router lazy-route contract. */
export { DiscountNew as Component, discountNewAction as action };
