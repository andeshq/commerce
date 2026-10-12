import { Button, ButtonGroup, Card, Dropdown, Label } from "@heroui/react";
import { EllipsisVertical, TrashBin } from "@gravity-ui/icons";
import {
  redirect,
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { pgbase, pgbaseErrorMessages } from "@/lib/pgbase";
import { PageHeader } from "@/lib/page-header";
import { OPTION_FORM_ID, OptionForm, optionToFormValues, useOptionForm } from "@/lib/option-form";
import { optionSchema, type OptionFormValues } from "@/lib/option-schema";
import { m } from "@/paraglide/messages.js";
import type { OptionWithValues } from "@/lib/catalog";

export async function optionDetailLoader({ params }: LoaderFunctionArgs) {
  const id = String(params.id);

  const [option, usage] = await Promise.all([
    pgbase
      .from("options")
      .select(
        "id,name,position,created_at,updated_at,option_values(id,option_id,value,position,variant_option_values(variant_id))",
      )
      .eq("id", id)
      .maybeSingle()
      .throwOnError(),
    pgbase.from("product_options").select("product_id").eq("option_id", id).throwOnError(),
  ]);

  if (!option.data) throw redirect("/options");

  return {
    option: option.data as OptionWithValues,
    usedBy: (usage.data as Array<{ product_id: string }>).length,
  };
}

export async function optionDetailAction({ request, params }: ActionFunctionArgs) {
  const optionId = String(params.id);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "update") {
    const values = JSON.parse(String(formData.get("payload"))) as OptionFormValues;
    const parsed = optionSchema.safeParse(values);
    if (!parsed.success) {
      return { errors: parsed.error.issues.map((issue) => issue.message) };
    }

    try {
      const current = await pgbase
        .from("options")
        .select("name")
        .eq("id", optionId)
        .single()
        .throwOnError();
      if (parsed.data.name !== (current.data as { name: string }).name) {
        await pgbase
          .from("options")
          .update({ name: parsed.data.name })
          .eq("id", optionId)
          .throwOnError();
      }

      // Nested writes never delete, so the form's row diff becomes explicit
      // removes, updates and inserts.
      const originalRows = await pgbase
        .from("option_values")
        .select("id,value,position")
        .eq("option_id", optionId)
        .order("position", { ascending: true })
        .throwOnError();
      const original = originalRows.data as Array<{ id: string; value: string; position: number }>;
      const originalById = new Map(original.map((row) => [row.id, row]));
      const keptIds = new Set(parsed.data.values.map((row) => row.id).filter(Boolean) as string[]);

      const removed = original.filter((row) => !keptIds.has(row.id));
      if (removed.length > 0) {
        await pgbase
          .from("option_values")
          .delete()
          .in("id", removed.map((row) => row.id))
          .throwOnError();
      }

      for (const [position, row] of parsed.data.values.entries()) {
        const existing = row.id ? originalById.get(row.id) : undefined;
        if (!existing) continue;

        const changes: { value?: string; position?: number } = {};
        if (existing.value !== row.value) changes.value = row.value;
        if (existing.position !== position) changes.position = position;
        if (Object.keys(changes).length > 0) {
          await pgbase
            .from("option_values")
            .update(changes)
            .eq("id", existing.id)
            .throwOnError();
        }
      }

      const added = parsed.data.values
        .map((row, position) => ({ row, position }))
        .filter(({ row }) => !row.id)
        .map(({ row, position }) => ({ option_id: optionId, value: row.value, position }));
      if (added.length > 0) {
        await pgbase.from("option_values").insert(added).throwOnError();
      }

      return redirect("/options");
    } catch (error) {
      return { errors: pgbaseErrorMessages(error) };
    }
  }

  if (intent === "delete") {
    try {
      await pgbase.from("options").delete().eq("id", optionId).throwOnError();
      return redirect("/options");
    } catch (error) {
      return { errors: pgbaseErrorMessages(error) };
    }
  }

  return { errors: [m.common_unknown_action()] };
}

export function OptionDetail() {
  const { option, usedBy } = useLoaderData<Awaited<ReturnType<typeof optionDetailLoader>>>();
  const fetcher = useFetcher<typeof optionDetailAction>();

  const submitting = fetcher.state !== "idle";
  const errors = fetcher.data?.errors ?? [];

  const form = useOptionForm({ initial: optionToFormValues(option) });
  const { isValid } = form.formState;

  function submit(values: OptionFormValues) {
    const formData = new FormData();
    formData.set("intent", "update");
    formData.set("payload", JSON.stringify(values));
    fetcher.submit(formData, { method: "post" });
  }

  function remove() {
    if (!window.confirm(m.options_delete_confirm({ name: option.name }))) return;
    const formData = new FormData();
    formData.set("intent", "delete");
    fetcher.submit(formData, { method: "post" });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={m.options_edit_title()}
        description={`${option.name} · ${m.common_used_by()} ${usedBy}`}
        actions={
          <>
            <Button variant="secondary" isDisabled={submitting} onPress={() => history.back()}>
              {m.common_cancel()}
            </Button>
            <ButtonGroup>
              <Button
                type="submit"
                form={OPTION_FORM_ID}
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
                    <Dropdown.Item id="delete" textValue={m.options_delete()} variant="danger">
                      <TrashBin className="size-4 shrink-0 text-danger" />
                      <Label>{m.options_delete()}</Label>
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
          <OptionForm
            form={form}
            submitting={submitting}
            errors={errors}
            hint={m.options_delete_hint()}
            onSubmit={submit}
          />
        </Card.Content>
      </Card>
    </div>
  );
}

/* React Router lazy-route contract. */
export { OptionDetail as Component, optionDetailLoader as loader, optionDetailAction as action };
