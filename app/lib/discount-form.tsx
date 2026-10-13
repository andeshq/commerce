import {
  Alert,
  FieldError,
  Input,
  InputGroup,
  Label,
  ListBox,
  Select,
  Switch,
  TextField,
} from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, type UseFormReturn, useForm } from "react-hook-form";
import { m } from "@/paraglide/messages.js";
import { currencySymbol } from "./catalog";
import {
  DISCOUNT_TYPES,
  type DiscountFormValues,
  type DiscountType,
  discountSchema,
} from "./discount-schema";

/** The detail pages submit this form from the page header, outside the <form>. */
export const DISCOUNT_FORM_ID = "discount-form";

const TYPE_LABEL: Record<DiscountType, () => string> = {
  percentage: m.discounts_type_percentage,
  fixed: m.discounts_type_fixed,
};

export function useDiscountForm({
  initial,
}: {
  initial?: Partial<DiscountFormValues>;
} = {}): UseFormReturn<DiscountFormValues> {
  return useForm<DiscountFormValues>({
    resolver: zodResolver(discountSchema),
    mode: "onChange",
    defaultValues: {
      code: initial?.code ?? "",
      type: initial?.type ?? "percentage",
      value: initial?.value ?? "",
      minSubtotal: initial?.minSubtotal ?? "",
      startsAt: initial?.startsAt ?? "",
      endsAt: initial?.endsAt ?? "",
      usageLimit: initial?.usageLimit ?? "",
      active: initial?.active ?? true,
    },
  });
}

export function DiscountForm({
  form,
  currency,
  locale,
  errors,
  onSubmit,
}: {
  form: UseFormReturn<DiscountFormValues>;
  currency: string;
  locale: string;
  errors: string[];
  onSubmit(values: DiscountFormValues): void;
}) {
  const { control } = form;
  const symbol = currencySymbol(currency, locale);
  const type = form.watch("type");

  return (
    <form
      id={DISCOUNT_FORM_ID}
      className="flex flex-col gap-5"
      onSubmit={form.handleSubmit(onSubmit)}
    >
      {errors.length > 0 && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{m.common_could_not_save()}</Alert.Title>
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
        <h3 className="text-sm font-semibold">{m.common_details()}</h3>

        <div className="grid gap-5 sm:grid-cols-2">
          <Controller
            control={control}
            name="code"
            render={({ field, fieldState }) => (
              <TextField
                isRequired
                fullWidth
                name={field.name}
                value={field.value}
                onChange={(value) => field.onChange(value.toUpperCase())}
                onBlur={field.onBlur}
                isInvalid={fieldState.invalid}
              >
                <Label>{m.discounts_code()}</Label>
                <Input placeholder={m.discounts_code_placeholder()} />
                <FieldError>{fieldState.error?.message}</FieldError>
              </TextField>
            )}
          />

          <Controller
            control={control}
            name="type"
            render={({ field }) => (
              <Select
                fullWidth
                name={field.name}
                value={field.value}
                onChange={(value) => field.onChange(String(value) as DiscountType)}
              >
                <Label>{m.discounts_type()}</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {DISCOUNT_TYPES.map((option) => (
                      <ListBox.Item key={option} id={option} textValue={TYPE_LABEL[option]()}>
                        {TYPE_LABEL[option]()}
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
            name="value"
            render={({ field, fieldState }) => (
              <TextField
                isRequired
                fullWidth
                name={field.name}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                isInvalid={fieldState.invalid}
              >
                <Label>{m.discounts_value()}</Label>
                <Input inputMode="decimal" placeholder={type === "percentage" ? "10" : "2000"} />
                <FieldError>{fieldState.error?.message}</FieldError>
                <p className="text-xs text-muted">{m.discounts_value_hint()}</p>
              </TextField>
            )}
          />

          <Controller
            control={control}
            name="minSubtotal"
            render={({ field }) => (
              <TextField
                fullWidth
                name={field.name}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
              >
                <Label>{m.discounts_min_subtotal()}</Label>
                <InputGroup>
                  <InputGroup.Prefix>{symbol}</InputGroup.Prefix>
                  <InputGroup.Input inputMode="decimal" />
                </InputGroup>
                <p className="text-xs text-muted">{m.discounts_min_subtotal_hint()}</p>
              </TextField>
            )}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">{m.discounts_window_hint()}</h3>

        <div className="grid gap-5 sm:grid-cols-2">
          <Controller
            control={control}
            name="startsAt"
            render={({ field }) => (
              <TextField
                fullWidth
                name={field.name}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
              >
                <Label>{m.discounts_starts_at()}</Label>
                <Input type="datetime-local" />
              </TextField>
            )}
          />

          <Controller
            control={control}
            name="endsAt"
            render={({ field }) => (
              <TextField
                fullWidth
                name={field.name}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
              >
                <Label>{m.discounts_ends_at()}</Label>
                <Input type="datetime-local" />
              </TextField>
            )}
          />

          <Controller
            control={control}
            name="usageLimit"
            render={({ field }) => (
              <TextField
                fullWidth
                name={field.name}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
              >
                <Label>{m.discounts_usage_limit()}</Label>
                <Input inputMode="numeric" />
                <p className="text-xs text-muted">{m.discounts_usage_limit_hint()}</p>
              </TextField>
            )}
          />

          <Controller
            control={control}
            name="active"
            render={({ field }) => (
              <div className="flex items-end pb-2">
                <Switch isSelected={field.value} onChange={field.onChange}>
                  <Switch.Content>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                    {m.discounts_active()}
                  </Switch.Content>
                </Switch>
              </div>
            )}
          />
        </div>
      </section>
    </form>
  );
}
