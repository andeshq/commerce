import { Controller, useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, FieldError, Input, Label, Separator, TextField } from "@heroui/react";
import { optionSchema, type OptionFormValues } from "./option-schema";
import { ValuesRows } from "./values-rows";
import type { OptionWithValues } from "./catalog";

/** The detail pages submit this form from the page header, outside the <form>. */
export const OPTION_FORM_ID = "option-form";

/** Existing option → form values, values in display order with their usage. */
export function optionToFormValues(option: OptionWithValues): OptionFormValues {
  return {
    name: option.name,
    values: [...option.option_values]
      .sort((a, b) => a.position - b.position)
      .map((value) => ({
        id: value.id,
        value: value.value,
        usage: value.variant_option_values?.length ?? 0,
      })),
  };
}

export function useOptionForm({
  initial,
}: {
  initial?: OptionFormValues;
} = {}): UseFormReturn<OptionFormValues> {
  return useForm<OptionFormValues>({
    resolver: zodResolver(optionSchema),
    mode: "onChange",
    defaultValues: initial ?? { name: "", values: [{ value: "" }] },
  });
}

export function OptionForm({
  form,
  submitting,
  errors,
  hint,
  onSubmit,
}: {
  form: UseFormReturn<OptionFormValues>;
  submitting: boolean;
  errors: string[];
  /** Square-style rule line shown under the values list. */
  hint?: string;
  onSubmit(values: OptionFormValues): void;
}) {
  const { control } = form;

  return (
    <form
      id={OPTION_FORM_ID}
      className="flex flex-col gap-5"
      onSubmit={form.handleSubmit(onSubmit)}
    >
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
                <Input placeholder="Size" />
                <FieldError>{fieldState.error?.message}</FieldError>
              </TextField>
            )}
          />
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Values</h3>
        <ValuesRows control={control} isDisabled={submitting} />
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </section>
    </form>
  );
}
