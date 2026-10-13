import {
  Alert,
  FieldError,
  Input,
  Label,
  ListBox,
  Select,
  TextArea,
  TextField,
} from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRef } from "react";
import { Controller, type UseFormReturn, useForm } from "react-hook-form";
import { m } from "@/paraglide/messages.js";
import { slugify } from "./catalog";
import { type CategoryFormValues, categorySchema, NO_PARENT } from "./category-schema";

/** The detail pages submit this form from the page header, outside the <form>. */
export const CATEGORY_FORM_ID = "category-form";

export function useCategoryForm({
  initial,
}: {
  initial?: Partial<CategoryFormValues>;
} = {}): UseFormReturn<CategoryFormValues> {
  return useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    mode: "onChange",
    defaultValues: {
      name: initial?.name ?? "",
      slug: initial?.slug ?? "",
      parentId: initial?.parentId ?? NO_PARENT,
      description: initial?.description ?? "",
    },
  });
}

export function CategoryForm({
  form,
  parentOptions,
  errors,
  onSubmit,
}: {
  form: UseFormReturn<CategoryFormValues>;
  /** Excludes the category itself and its descendants when editing. */
  parentOptions: Array<{ id: string; label: string }>;
  submitting: boolean;
  errors: string[];
  onSubmit(values: CategoryFormValues): void;
}) {
  const { control, getValues, setValue } = form;
  const slugTouched = useRef(Boolean(getValues("slug")));

  return (
    <form
      id={CATEGORY_FORM_ID}
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
            name="name"
            render={({ field, fieldState }) => (
              <TextField
                isRequired
                fullWidth
                name={field.name}
                value={field.value}
                onChange={(value) => {
                  field.onChange(value);
                  if (!slugTouched.current) {
                    setValue("slug", slugify(value), { shouldValidate: true });
                  }
                }}
                onBlur={field.onBlur}
                isInvalid={fieldState.invalid}
              >
                <Label>{m.category_name()}</Label>
                <Input placeholder={m.category_name_placeholder()} />
                <FieldError>{fieldState.error?.message}</FieldError>
              </TextField>
            )}
          />

          <Controller
            control={control}
            name="slug"
            render={({ field, fieldState }) => (
              <TextField
                isRequired
                fullWidth
                name={field.name}
                value={field.value}
                onChange={(value) => {
                  slugTouched.current = true;
                  field.onChange(value);
                }}
                onBlur={field.onBlur}
                isInvalid={fieldState.invalid}
              >
                <Label>{m.category_slug()}</Label>
                <Input placeholder={m.category_slug_placeholder()} />
                <FieldError>{fieldState.error?.message}</FieldError>
              </TextField>
            )}
          />

          <Controller
            control={control}
            name="parentId"
            render={({ field }) => (
              <Select
                fullWidth
                name={field.name}
                value={field.value}
                onChange={(value) => field.onChange(String(value))}
              >
                <Label>{m.category_parent()}</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id={NO_PARENT} textValue={m.common_none()}>
                      {m.common_none()}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    {parentOptions.map((option) => (
                      <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
                        {option.label}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            )}
          />
        </div>

        <Controller
          control={control}
          name="description"
          render={({ field }) => (
            <TextField
              fullWidth
              name={field.name}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
            >
              <Label>{m.category_description()}</Label>
              <TextArea placeholder={m.category_description_placeholder()} rows={3} />
            </TextField>
          )}
        />
      </section>
    </form>
  );
}
