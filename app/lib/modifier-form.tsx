import { useState } from "react";
import { Controller, useFieldArray, useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  Button,
  FieldError,
  Input,
  InputGroup,
  Label,
  ListBox,
  Select,
  Separator,
  Switch,
  TextField,
} from "@heroui/react";
import { Xmark } from "@gravity-ui/icons";
import { cents, type ModifierGroupWithValues } from "./catalog";
import { modifierSchema, type ModifierFormValues } from "./modifier-schema";

/** The detail pages submit this form from the page header, outside the <form>. */
export const MODIFIER_FORM_ID = "modifier-form";

/** Existing group → form values, prices in currency units. */
export function modifierToFormValues(group: ModifierGroupWithValues): ModifierFormValues {
  return {
    name: group.name,
    selectionType: group.selection_type,
    required: group.required,
    values: [...group.modifier_values]
      .sort((a, b) => a.position - b.position)
      .map((value) => ({
        id: value.id,
        name: value.name,
        price: cents(value.price_delta_cents) === 0 ? "" : String(cents(value.price_delta_cents) / 100),
      })),
  };
}

export function useModifierForm({
  initial,
}: {
  initial?: ModifierFormValues;
} = {}): UseFormReturn<ModifierFormValues> {
  return useForm<ModifierFormValues>({
    resolver: zodResolver(modifierSchema),
    mode: "onChange",
    defaultValues: initial ?? {
      name: "",
      selectionType: "multiple",
      required: false,
      values: [{ name: "", price: "" }],
    },
  });
}

export function ModifierForm({
  form,
  symbol,
  submitting,
  errors,
  hint,
  onSubmit,
}: {
  form: UseFormReturn<ModifierFormValues>;
  /** Currency symbol shown as the price prefix. */
  symbol: string;
  submitting: boolean;
  errors: string[];
  hint?: string;
  onSubmit(values: ModifierFormValues): void;
}) {
  const { control } = form;
  const [draft, setDraft] = useState("");
  const values = useFieldArray({ control, name: "values", keyName: "key" });

  function commitDraft() {
    const name = draft.trim();
    if (!name) return;
    values.append({ name, price: "" });
    setDraft("");
  }

  return (
    <form id={MODIFIER_FORM_ID} className="flex flex-col gap-5" onSubmit={form.handleSubmit(onSubmit)}>
      {errors.length > 0 && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Could not save</Alert.Title>
            <Alert.Description>
              <ul className="list-inside list-disc">
                {errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Details</h3>

        <div className="grid gap-5 sm:grid-cols-2">
          <Controller
            control={control}
            name="name"
            render={({ field, fieldState }) => (
              <TextField
                isRequired
                fullWidth
                name={field.name}
                isDisabled={submitting}
                isInvalid={fieldState.invalid}
                value={field.value}
                onBlur={field.onBlur}
                onChange={field.onChange}
              >
                <Label>Name</Label>
                <Input placeholder="Personalización" />
                <FieldError>{fieldState.error?.message}</FieldError>
              </TextField>
            )}
          />

          <Controller
            control={control}
            name="selectionType"
            render={({ field }) => (
              <Select
                fullWidth
                name={field.name}
                value={field.value}
                onChange={(value) => field.onChange(String(value))}
              >
                <Label>Selection</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="single" textValue="Single choice">
                      Single choice
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="multiple" textValue="Multiple choice">
                      Multiple choice
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
            )}
          />
        </div>

        <Controller
          control={control}
          name="required"
          render={({ field }) => (
            <Switch name={field.name} isSelected={field.value} onChange={field.onChange}>
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                Required — customers must pick at least one
              </Switch.Content>
            </Switch>
          )}
        />
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <div className="flex flex-col">
          <h3 className="text-sm font-semibold">Values</h3>
          <p className="text-xs text-muted">
            Each value can change the price of the item it is applied to.
          </p>
        </div>

        {values.fields.map((fieldRow, index) => (
          <div key={fieldRow.key} className="flex items-start gap-3">
            <Controller
              control={control}
              name={`values.${index}.name`}
              render={({ field, fieldState }) => (
                <TextField
                  fullWidth
                  aria-label={`Value ${index + 1}`}
                  isDisabled={submitting}
                  isInvalid={fieldState.invalid}
                  value={field.value ?? ""}
                  onBlur={field.onBlur}
                  onChange={field.onChange}
                >
                  <Input placeholder="Value" />
                  <FieldError>{fieldState.error?.message}</FieldError>
                </TextField>
              )}
            />

            <Controller
              control={control}
              name={`values.${index}.price`}
              render={({ field, fieldState }) => (
                <TextField
                  className="w-36 shrink-0"
                  aria-label={`Value ${index + 1} price`}
                  isInvalid={fieldState.invalid}
                >
                  <InputGroup>
                    <InputGroup.Prefix>{symbol}</InputGroup.Prefix>
                    <InputGroup.Input
                      placeholder="0"
                      value={field.value ?? ""}
                      disabled={submitting}
                      onBlur={field.onBlur}
                      onChange={(event) => field.onChange(event.target.value)}
                    />
                  </InputGroup>
                  <FieldError>{fieldState.error?.message}</FieldError>
                </TextField>
              )}
            />

            <Button
              aria-label={`Remove value ${index + 1}`}
              isIconOnly
              size="sm"
              variant="tertiary"
              className="mt-0.5"
              isDisabled={submitting || values.fields.length === 1}
              onPress={() => values.remove(index)}
            >
              <Xmark className="size-4" />
            </Button>
          </div>
        ))}

        <Input
          aria-label="Add a value"
          placeholder="Add value"
          className="w-full"
          disabled={submitting}
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

        {hint && <p className="text-xs text-muted">{hint}</p>}
      </section>
    </form>
  );
}
