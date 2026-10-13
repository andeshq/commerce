import { EllipsisVertical, TrashBin } from "@gravity-ui/icons";
import { Button, ButtonGroup, Card, Dropdown, Label } from "@heroui/react";
import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  redirect,
  useFetcher,
  useLoaderData,
} from "react-router";
import { DISCOUNT_FORM_ID, DiscountForm, useDiscountForm } from "@/lib/discount-form";
import {
  type DiscountFormValues,
  type DiscountRecord,
  discountPayload,
  discountSchema,
  discountToForm,
} from "@/lib/discount-schema";
import { PageHeader } from "@/lib/page-header";
import { pgbase, pgbaseErrorMessages } from "@/lib/pgbase";
import { m } from "@/paraglide/messages.js";
import { useAdminStore } from "@/routes/admin/adminLayout";

export async function discountDetailLoader({ params }: LoaderFunctionArgs) {
  const id = String(params.id);
  const discount = await pgbase
    .from("discounts")
    .select(
      "id,code,type,value,min_subtotal_cents,starts_at,ends_at,usage_limit,times_used,active,updated_at",
    )
    .eq("id", id)
    .maybeSingle()
    .throwOnError();

  if (!discount.data) throw redirect("/discounts");

  return {
    discount: discount.data as DiscountRecord & { id: string; times_used: number },
  };
}

export async function discountDetailAction({ request, params }: ActionFunctionArgs) {
  const discountId = String(params.id);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "update") {
    const values = JSON.parse(String(formData.get("payload"))) as DiscountFormValues;
    const parsed = discountSchema.safeParse(values);
    if (!parsed.success) {
      return { errors: parsed.error.issues.map((issue) => issue.message) };
    }

    const payload = discountPayload(parsed.data);
    if (!payload.ok) return { errors: payload.errors };

    try {
      await pgbase.from("discounts").update(payload.data).eq("id", discountId).throwOnError();
      return redirect("/discounts");
    } catch (error) {
      return { errors: pgbaseErrorMessages(error) };
    }
  }

  if (intent === "delete") {
    try {
      await pgbase.from("discounts").delete().eq("id", discountId).throwOnError();
      return redirect("/discounts");
    } catch (error) {
      return { errors: pgbaseErrorMessages(error) };
    }
  }

  return { errors: [m.common_unknown_action()] };
}

export function DiscountDetail() {
  const { discount } = useLoaderData<Awaited<ReturnType<typeof discountDetailLoader>>>();
  const store = useAdminStore();
  const fetcher = useFetcher<typeof discountDetailAction>();

  const submitting = fetcher.state !== "idle";
  const errors = fetcher.data?.errors ?? [];

  const form = useDiscountForm({ initial: discountToForm(discount) });
  const { isValid } = form.formState;

  function submit(values: DiscountFormValues) {
    const formData = new FormData();
    formData.set("intent", "update");
    formData.set("payload", JSON.stringify(values));
    fetcher.submit(formData, { method: "post" });
  }

  function remove() {
    if (!window.confirm(m.discounts_delete_confirm({ code: discount.code }))) return;
    const formData = new FormData();
    formData.set("intent", "delete");
    fetcher.submit(formData, { method: "post" });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={m.discounts_edit_title()}
        description={discount.code}
        actions={
          <>
            <Button variant="secondary" isDisabled={submitting} onPress={() => history.back()}>
              {m.common_cancel()}
            </Button>
            <ButtonGroup>
              <Button
                type="submit"
                form={DISCOUNT_FORM_ID}
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
                    <Dropdown.Item id="delete" textValue={m.discounts_delete()} variant="danger">
                      <TrashBin className="size-4 shrink-0 text-danger" />
                      <Label>{m.discounts_delete()}</Label>
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
export {
  DiscountDetail as Component,
  discountDetailAction as action,
  discountDetailLoader as loader,
};
