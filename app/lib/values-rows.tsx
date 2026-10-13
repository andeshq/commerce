import { Xmark } from "@gravity-ui/icons";
import { Button, FieldError, Input, TextField } from "@heroui/react";
import { useState } from "react";
import {
  type Control,
  Controller,
  type FieldArrayPath,
  type FieldPath,
  type FieldValues,
  useFieldArray,
} from "react-hook-form";
import { m } from "@/paraglide/messages.js";

/** Form state for one option value; `id`/`usage` are set for saved rows. */
export interface ValueRow {
  id?: string;
  value: string;
  usage?: number;
}

/**
 * One input per value (Square-style): no delimiter to type. New rows come from
 * the inline "Add value" row at the bottom, saved rows show how many variants
 * use them, and removal is blocked on the last row because an option needs at
 * least one value.
 *
 * Rows always live at `values`; RHF's field-array generics do not survive the
 * generic `control` hand-off, so the two call sites into them are cast.
 */
export function ValuesRows<T extends FieldValues & { values: ValueRow[] }>({
  control,
  label,
  isDisabled,
}: {
  control: Control<T>;
  /** Prefix for each row's accessible name, kept unique across the page. */
  label?: string;
  isDisabled?: boolean;
}) {
  const valueLabel = label ?? m.common_value_placeholder();
  const { fields, append, remove } = useFieldArray({
    control,
    name: "values" as FieldArrayPath<T>,
    keyName: "key",
  });
  const [draft, setDraft] = useState("");

  function commitDraft() {
    const value = draft.trim();
    if (!value) return;
    append({ value } as unknown as Parameters<typeof append>[0]);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-2">
      {fields.map((fieldRow, index) => {
        // The generic field-array type can't see row extras; the row shape is fixed.
        const usage = (fieldRow as unknown as ValueRow).usage;

        return (
          <div key={fieldRow.key} className="flex items-start gap-3">
            <Controller
              control={control}
              name={`values.${index}.value` as FieldPath<T>}
              render={({ field, fieldState }) => (
                <TextField
                  fullWidth
                  aria-label={`${valueLabel} ${index + 1}`}
                  isDisabled={isDisabled}
                  isInvalid={fieldState.invalid}
                  value={field.value ?? ""}
                  onBlur={field.onBlur}
                  onChange={field.onChange}
                >
                  <Input placeholder={m.common_value_placeholder()} />
                  <FieldError>{fieldState.error?.message}</FieldError>
                </TextField>
              )}
            />

            {usage !== undefined && (
              <span className="pt-2.5 text-xs whitespace-nowrap text-muted">
                {usage === 1
                  ? m.count_variant_one({ count: usage })
                  : m.count_variant_other({ count: usage })}
              </span>
            )}

            <Button
              aria-label={m.values_remove({ label: valueLabel, index: String(index + 1) })}
              isIconOnly
              size="sm"
              variant="tertiary"
              className="mt-0.5"
              isDisabled={isDisabled || fields.length === 1}
              onPress={() => remove(index)}
            >
              <Xmark className="size-4" />
            </Button>
          </div>
        );
      })}

      <Input
        aria-label={m.common_add_value()}
        placeholder={m.common_add_value()}
        className="w-full"
        disabled={isDisabled}
        value={draft}
        onBlur={commitDraft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitDraft();
          }
        }}
      />
    </div>
  );
}
