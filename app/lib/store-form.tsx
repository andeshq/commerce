import { Controller, useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  FieldError,
  Input,
  Label,
  ListBox,
  Select,
  Switch,
  TextField,
} from "@heroui/react";
import { storeSchema, type StoreFormValues } from "./store-schema";
import {
  CURRENCIES,
  CURRENCY_LABELS,
  isCurrencyCode,
  isLocaleCode,
  LOCALES,
  LOCALE_LABELS,
} from "./ref-data";
import type { Store } from "./catalog";

/** The page header submits this form from outside the <form>. */
export const STORE_FORM_ID = "store-form";

export function useStoreForm({
  initial,
}: {
  initial?: Store;
}): UseFormReturn<StoreFormValues> {
  return useForm<StoreFormValues>({
    resolver: zodResolver(storeSchema),
    mode: "onChange",
    defaultValues: {
      name: initial?.name ?? "",
      currencyCode: isCurrencyCode(initial?.currency_code) ? initial.currency_code : "COP",
      locale: isLocaleCode(initial?.locale) ? initial.locale : "es-CO",
      taxLabel: initial?.tax_label ?? "Tax",
      taxRate: initial ? String(initial.tax_rate_bps / 100) : "0",
      pricesIncludeTax: initial?.prices_include_tax ?? false,
    },
  });
}

export function StoreForm({
  form,
  isDisabled,
  submitting,
  errors,
  onSubmit,
}: {
  form: UseFormReturn<StoreFormValues>;
  isDisabled: boolean;
  submitting: boolean;
  errors: string[];
  onSubmit(values: StoreFormValues): void;
}) {
  const { control } = form;

  return (
    <form
      id={STORE_FORM_ID}
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
                isDisabled={isDisabled}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                isInvalid={fieldState.invalid}
              >
                <Label>Store name</Label>
                <Input placeholder="Safiro" />
                <FieldError>{fieldState.error?.message}</FieldError>
              </TextField>
            )}
          />

          <Controller
            control={control}
            name="currencyCode"
            render={({ field }) => (
              <Select
                fullWidth
                name={field.name}
                isDisabled={isDisabled || submitting}
                value={field.value}
                onChange={(value) => field.onChange(String(value))}
              >
                <Label>Currency</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {CURRENCIES.map((code) => (
                      <ListBox.Item
                        key={code}
                        id={code}
                        textValue={`${code} ${CURRENCY_LABELS[code]}`}
                      >
                        {code} — {CURRENCY_LABELS[code]}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            )}
          />

          <Controller
            control={control}
            name="locale"
            render={({ field }) => (
              <Select
                fullWidth
                name={field.name}
                isDisabled={isDisabled || submitting}
                value={field.value}
                onChange={(value) => field.onChange(String(value))}
              >
                <Label>Locale</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {LOCALES.map((code) => (
                      <ListBox.Item key={code} id={code} textValue={LOCALE_LABELS[code]}>
                        {LOCALE_LABELS[code]}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            )}
          />

          <Controller
            control={control}
            name="taxLabel"
            render={({ field, fieldState }) => (
              <TextField
                isRequired
                fullWidth
                name={field.name}
                isDisabled={isDisabled}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                isInvalid={fieldState.invalid}
              >
                <Label>Tax label</Label>
                <Input placeholder="IVA" />
                <FieldError>{fieldState.error?.message}</FieldError>
              </TextField>
            )}
          />

          <Controller
            control={control}
            name="taxRate"
            render={({ field, fieldState }) => (
              <TextField
                isRequired
                fullWidth
                name={field.name}
                isDisabled={isDisabled}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                isInvalid={fieldState.invalid}
              >
                <Label>Tax rate (%)</Label>
                <Input placeholder="19" />
                <FieldError>{fieldState.error?.message}</FieldError>
              </TextField>
            )}
          />

          <Controller
            control={control}
            name="pricesIncludeTax"
            render={({ field }) => (
              <div className="flex items-end pb-1">
                <Switch
                  isSelected={field.value}
                  isDisabled={isDisabled || submitting}
                  onChange={field.onChange}
                >
                  <Switch.Content>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                    Prices include tax
                  </Switch.Content>
                </Switch>
              </div>
            )}
          />
        </div>

        <p className="text-xs text-muted">
          Currency and locale drive how money is formatted across the admin.
        </p>
      </section>
    </form>
  );
}
