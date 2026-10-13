import { Alert, FieldError, Input, Label, TextArea, TextField } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRef } from "react";
import { Controller, type UseFormReturn, useForm } from "react-hook-form";
import { m } from "@/paraglide/messages.js";
import { slugify } from "./catalog";
import { type CollectionFormValues, collectionSchema } from "./collection-schema";

/** The detail pages submit this form from the page header, outside the <form>. */
export const COLLECTION_FORM_ID = "collection-form";

export function useCollectionForm({
  initial,
}: {
  initial?: Partial<CollectionFormValues>;
} = {}): UseFormReturn<CollectionFormValues> {
  return useForm<CollectionFormValues>({
    resolver: zodResolver(collectionSchema),
    mode: "onChange",
    defaultValues: {
      name: initial?.name ?? "",
      slug: initial?.slug ?? "",
      description: initial?.description ?? "",
    },
  });
}

export function CollectionForm({
  form,
  errors,
  onSubmit,
}: {
  form: UseFormReturn<CollectionFormValues>;
  errors: string[];
  onSubmit(values: CollectionFormValues): void;
}) {
  const { control, getValues, setValue } = form;
  const slugTouched = useRef(Boolean(getValues("slug")));

  return (
    <form
      id={COLLECTION_FORM_ID}
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
                <Label>{m.collections_name()}</Label>
                <Input placeholder={m.collections_name_placeholder()} />
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
                <Label>{m.collections_slug()}</Label>
                <Input placeholder={m.collections_slug_placeholder()} />
                <FieldError>{fieldState.error?.message}</FieldError>
              </TextField>
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
              <Label>{m.collections_description_label()}</Label>
              <TextArea rows={3} />
            </TextField>
          )}
        />
      </section>
    </form>
  );
}
