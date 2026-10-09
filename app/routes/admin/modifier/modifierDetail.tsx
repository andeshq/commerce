import { Button, Card, Dropdown, Label } from "@heroui/react";
import { ChevronDown, TrashBin } from "@gravity-ui/icons";
import {
  redirect,
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { useAdminStore } from "@/routes/admin/adminLayout";
import { pgbase, pgbaseErrorMessages } from "@/lib/pgbase";
import { PageHeader } from "@/lib/page-header";
import {
  MODIFIER_FORM_ID,
  ModifierForm,
  modifierToFormValues,
  useModifierForm,
} from "@/lib/modifier-form";
import { modifierSchema, type ModifierFormValues } from "@/lib/modifier-schema";
import { cents, currencySymbol, toCents } from "@/lib/catalog";
import type { ModifierGroupWithValues } from "@/lib/catalog";

export async function modifierDetailLoader({ params }: LoaderFunctionArgs) {
  const id = String(params.id);

  const [group, usage] = await Promise.all([
    pgbase
      .from("modifier_groups")
      .select(
        "id,name,selection_type,required,position,created_at,updated_at,modifier_values(id,group_id,name,price_delta_cents::text,position)",
      )
      .eq("id", id)
      .maybeSingle()
      .throwOnError(),
    pgbase.from("product_modifier_groups").select("product_id").eq("group_id", id).throwOnError(),
  ]);

  if (!group.data) throw redirect("/admin/modifiers");

  return {
    group: group.data as ModifierGroupWithValues,
    usedBy: (usage.data as Array<{ product_id: string }>).length,
  };
}

export async function modifierDetailAction({ request, params }: ActionFunctionArgs) {
  const groupId = String(params.id);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "update") {
    const values = JSON.parse(String(formData.get("payload"))) as ModifierFormValues;
    const parsed = modifierSchema.safeParse(values);
    if (!parsed.success) {
      return { errors: parsed.error.issues.map((issue) => issue.message) };
    }

    try {
      const currentRow = await pgbase
        .from("modifier_groups")
        .select("name,selection_type,required")
        .eq("id", groupId)
        .single()
        .throwOnError();
      const current = currentRow.data as {
        name: string;
        selection_type: string;
        required: boolean;
      };

      const changes: {
        name?: string;
        selection_type?: string;
        required?: boolean;
      } = {};
      if (parsed.data.name !== current.name) changes.name = parsed.data.name;
      if (parsed.data.selectionType !== current.selection_type) {
        changes.selection_type = parsed.data.selectionType;
      }
      if (parsed.data.required !== current.required) changes.required = parsed.data.required;
      if (Object.keys(changes).length > 0) {
        await pgbase.from("modifier_groups").update(changes).eq("id", groupId).throwOnError();
      }

      // Nested writes never delete, so the form's row diff becomes explicit
      // removes, updates and inserts.
      const originalRows = await pgbase
        .from("modifier_values")
        .select("id,name,price_delta_cents::text,position")
        .eq("group_id", groupId)
        .order("position", { ascending: true })
        .throwOnError();
      const original = originalRows.data as Array<{
        id: string;
        name: string;
        price_delta_cents: string;
        position: number;
      }>;
      const originalById = new Map(original.map((row) => [row.id, row]));
      const keptIds = new Set(parsed.data.values.map((row) => row.id).filter(Boolean) as string[]);

      const removed = original.filter((row) => !keptIds.has(row.id));
      if (removed.length > 0) {
        await pgbase
          .from("modifier_values")
          .delete()
          .in("id", removed.map((row) => row.id))
          .throwOnError();
      }

      for (const [position, row] of parsed.data.values.entries()) {
        const existing = row.id ? originalById.get(row.id) : undefined;
        if (!existing) continue;

        const price = toCents(row.price) ?? 0;
        const rowChanges: { name?: string; price_delta_cents?: number; position?: number } = {};
        if (existing.name !== row.name) rowChanges.name = row.name;
        if (cents(existing.price_delta_cents) !== price) rowChanges.price_delta_cents = price;
        if (existing.position !== position) rowChanges.position = position;
        if (Object.keys(rowChanges).length > 0) {
          await pgbase
            .from("modifier_values")
            .update(rowChanges)
            .eq("id", existing.id)
            .throwOnError();
        }
      }

      const added = parsed.data.values
        .map((row, position) => ({ row, position }))
        .filter(({ row }) => !row.id)
        .map(({ row, position }) => ({
          group_id: groupId,
          name: row.name,
          price_delta_cents: toCents(row.price) ?? 0,
          position,
        }));
      if (added.length > 0) {
        await pgbase.from("modifier_values").insert(added).throwOnError();
      }

      return redirect("/admin/modifiers");
    } catch (error) {
      return { errors: pgbaseErrorMessages(error) };
    }
  }

  if (intent === "delete") {
    try {
      await pgbase.from("modifier_groups").delete().eq("id", groupId).throwOnError();
      return redirect("/admin/modifiers");
    } catch (error) {
      return { errors: pgbaseErrorMessages(error) };
    }
  }

  return { errors: ["Unknown action."] };
}

export function ModifierDetail() {
  const { group, usedBy } = useLoaderData<Awaited<ReturnType<typeof modifierDetailLoader>>>();
  const store = useAdminStore();
  const fetcher = useFetcher<typeof modifierDetailAction>();

  const submitting = fetcher.state !== "idle";
  const errors = fetcher.data?.errors ?? [];

  const form = useModifierForm({ initial: modifierToFormValues(group) });
  const { isValid } = form.formState;
  const symbol = currencySymbol(store?.currency_code ?? "COP", store?.locale ?? "es-CO");

  function submit(values: ModifierFormValues) {
    const formData = new FormData();
    formData.set("intent", "update");
    formData.set("payload", JSON.stringify(values));
    fetcher.submit(formData, { method: "post" });
  }

  function remove() {
    if (!window.confirm(`Delete modifier “${group.name}”?`)) return;
    const formData = new FormData();
    formData.set("intent", "delete");
    fetcher.submit(formData, { method: "post" });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Edit modifier"
        description={`${group.name} · used by ${usedBy} ${usedBy === 1 ? "product" : "products"}`}
        actions={
          <>
            <Dropdown>
              <Button variant="secondary" isDisabled={submitting}>
                Actions
                <ChevronDown className="size-4 text-muted" />
              </Button>
              <Dropdown.Popover>
                <Dropdown.Menu
                  onAction={(key) => {
                    if (key === "delete") void remove();
                  }}
                >
                  <Dropdown.Item id="delete" textValue="Delete modifier" variant="danger">
                    <TrashBin className="size-4 shrink-0 text-danger" />
                    <Label>Delete modifier</Label>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
            <Button variant="secondary" isDisabled={submitting} onPress={() => history.back()}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={MODIFIER_FORM_ID}
              isDisabled={submitting || !isValid}
              isPending={submitting}
            >
              {submitting ? "Saving…" : "Save changes"}
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
            hint="To delete a modifier, first detach it from its products."
            onSubmit={submit}
          />
        </Card.Content>
      </Card>
    </div>
  );
}

/* React Router lazy-route contract. */
export { ModifierDetail as Component, modifierDetailLoader as loader, modifierDetailAction as action };
