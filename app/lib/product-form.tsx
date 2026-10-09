import { useRef, useState, type ReactNode } from "react";
import { Controller, useFieldArray, useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  Button,
  Checkbox,
  Dropdown,
  FieldError,
  Input,
  Label,
  ListBox,
  Select,
  Separator,
  Tag,
  TagGroup,
  TextField,
} from "@heroui/react";
import { Plus, Xmark } from "@gravity-ui/icons";
import { RichTextEditor } from "./rich-text-editor";
import {
  categoryPath,
  categoryTree,
  cents,
  formatMoney,
  PRODUCT_STATUSES,
  slugify,
  type Category,
  type ModifierGroupWithValues,
  type OptionWithValues,
} from "./catalog";
import { emptyVariant, MAX_VARIANTS, combinationCount, syncVariants } from "./product-draft";
import type { VariantDraft } from "./product-schema";
import {
  NO_CATEGORY,
  productFormSchema,
  type ProductFields,
  type ProductFormValues,
} from "./product-schema";

/** The detail pages submit this form from the page header, outside the <form>. */
export const PRODUCT_FORM_ID = "product-form";

export function useProductForm({
  initial,
  optionIds = [],
  modifierIds = [],
  variants,
}: {
  initial?: Partial<ProductFields>;
  optionIds?: string[];
  modifierIds?: string[];
  variants?: ProductFormValues["variants"];
}): UseFormReturn<ProductFormValues> {
  return useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    mode: "onChange",
    defaultValues: {
      title: initial?.title ?? "",
      slug: initial?.slug ?? "",
      status: initial?.status ?? "draft",
      vendor: initial?.vendor ?? "",
      productType: initial?.productType ?? "",
      categoryId: initial?.categoryId ?? NO_CATEGORY,
      description: initial?.description ?? "",
      optionIds,
      modifierGroupIds: modifierIds,
      variants: variants ?? [emptyVariant("Default")],
    },
  });
}

export function ProductForm({
  form,
  options,
  categories,
  modifiers,
  currency,
  locale,
  images,
  variantImage,
  submitting,
  errors,
  onSubmit,
}: {
  form: UseFormReturn<ProductFormValues>;
  options: OptionWithValues[];
  categories: Category[];
  modifiers: ModifierGroupWithValues[];
  currency: string;
  locale: string;
  /** Image section, owned by the page because uploads happen immediately. */
  images?: ReactNode;
  /** Variant image picker, owned by the page because links are written immediately. */
  variantImage?: (variant: VariantDraft, index: number) => ReactNode;
  submitting: boolean;
  errors: string[];
  onSubmit(values: ProductFormValues): void;
}) {
  const { control, getValues, setValue, watch } = form;
  const slugTouched = useRef(Boolean(form.getValues("slug")));

  // `keyName` keeps the generated React key off the `id` field, which carries
  // the database id for saved rows.
  const variantArray = useFieldArray({ control, name: "variants", keyName: "key" });
  const [optionError, setOptionError] = useState<string | null>(null);
  const optionIds = watch("optionIds");
  const modifierGroupIds = watch("modifierGroupIds");
  const selectedOptions = options.filter((option) => optionIds.includes(option.id));
  const availableOptions = options.filter((option) => !optionIds.includes(option.id));
  const selectedModifiers = modifiers.filter((group) => modifierGroupIds.includes(group.id));
  const availableModifiers = modifiers.filter((group) => !modifierGroupIds.includes(group.id));

  function applyOptionIds(ids: string[]) {
    const nextOptions = options.filter((option) => ids.includes(option.id));
    const count = combinationCount(nextOptions);
    if (count > MAX_VARIANTS) {
      setOptionError(
        `Those options create ${count} variants; a product can have at most ${MAX_VARIANTS}. Remove a few values first.`,
      );
      return;
    }

    setOptionError(null);
    setValue("optionIds", ids, { shouldDirty: true });
    variantArray.replace(syncVariants(getValues("variants"), nextOptions));
  }

  /** Modifiers never change the variant matrix, so the rows are left alone. */
  function applyModifierIds(ids: string[]) {
    setValue("modifierGroupIds", ids, { shouldDirty: true });
  }

  return (
    <form id={PRODUCT_FORM_ID} className="flex flex-col gap-5" onSubmit={form.handleSubmit(onSubmit)}>
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

      <div className="grid gap-5 sm:grid-cols-2">
        <Controller
          control={control}
          name="title"
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
              <Label>Title</Label>
              <Input placeholder="Classic T-shirt" />
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
              <Label>Slug</Label>
              <Input placeholder="classic-t-shirt" />
              <FieldError>{fieldState.error?.message}</FieldError>
            </TextField>
          )}
        />

        <Controller
          control={control}
          name="status"
          render={({ field }) => (
            <Select
              fullWidth
              name={field.name}
              value={field.value}
              onChange={(value) => field.onChange(String(value))}
            >
              <Label>Status</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {PRODUCT_STATUSES.map((status) => (
                    <ListBox.Item key={status} id={status} textValue={status}>
                      {status}
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
          name="vendor"
          render={({ field }) => (
            <TextField
              fullWidth
              name={field.name}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
            >
              <Label>Vendor</Label>
              <Input placeholder="Andes" />
            </TextField>
          )}
        />

        <Controller
          control={control}
          name="productType"
          render={({ field }) => (
            <TextField
              fullWidth
              name={field.name}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
            >
              <Label>Type</Label>
              <Input placeholder="Camiseta" />
            </TextField>
          )}
        />

        <Controller
          control={control}
          name="categoryId"
          render={({ field }) => (
            <Select
              fullWidth
              name={field.name}
              value={field.value}
              onChange={(value) => field.onChange(String(value))}
            >
              <Label>Category</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id={NO_CATEGORY} textValue="None">
                    None
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                  {categoryTree(categories).map(({ category }) => (
                    <ListBox.Item
                      key={category.id}
                      id={category.id}
                      textValue={categoryPath(categories, category.id)}
                    >
                      {categoryPath(categories, category.id)}
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
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Description</span>
            <RichTextEditor
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              isDisabled={submitting}
            />
          </div>
        )}
      />

      {images && (
        <>
          <Separator />
          <section className="flex flex-col gap-3">
            <div className="flex flex-col">
              <h3 className="text-sm font-semibold">Images</h3>
              <p className="text-xs text-muted">
                Uploads land in the image library; the first image is the main one.
              </p>
            </div>
            {images}
          </section>
        </>
      )}

      <Separator />

      <section className="flex flex-col gap-3">
        <div className="flex flex-col">
          <h3 className="text-sm font-semibold">Options</h3>
          <p className="text-xs text-muted">
            Pick from the store library; variants are generated for every combination.
          </p>
        </div>

        {options.length === 0 ? (
          <p className="text-sm text-muted">
            No options in the library yet — create one under Options.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {selectedOptions.length > 0 && (
              <TagGroup
                aria-label="Selected options"
                onRemove={(keys) => applyOptionIds(optionIds.filter((id) => !keys.has(id)))}
              >
                <TagGroup.List>
                  {selectedOptions.map((option) => (
                    <Tag key={option.id} id={option.id} textValue={option.name}>
                      {option.name}
                      <Tag.RemoveButton>
                        <Xmark className="size-3" />
                      </Tag.RemoveButton>
                    </Tag>
                  ))}
                </TagGroup.List>
              </TagGroup>
            )}

            {availableOptions.length > 0 && (
              <Dropdown>
                <Button size="sm" variant="secondary" isDisabled={submitting}>
                  <Plus className="size-4" />
                  Add option
                </Button>
                <Dropdown.Popover>
                  <Dropdown.Menu onAction={(key) => applyOptionIds([...optionIds, String(key)])}>
                    {availableOptions.map((option) => (
                      <Dropdown.Item key={option.id} id={option.id} textValue={option.name}>
                        <Label>{option.name}</Label>
                        <span className="text-xs text-muted">
                          {option.option_values.map((value) => value.value).join(", ")}
                        </span>
                      </Dropdown.Item>
                    ))}
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            )}
          </div>
        )}

        {optionError && <p className="text-xs text-danger">{optionError}</p>}
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <div className="flex flex-col">
          <h3 className="text-sm font-semibold">Modifiers</h3>
          <p className="text-xs text-muted">
            Priced add-ons customers can pick at checkout.
          </p>
        </div>

        {modifiers.length === 0 ? (
          <p className="text-sm text-muted">
            No modifiers yet — create one under Modifiers.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {selectedModifiers.length > 0 && (
              <TagGroup
                aria-label="Selected modifiers"
                onRemove={(keys) =>
                  applyModifierIds(modifierGroupIds.filter((id) => !keys.has(id)))
                }
              >
                <TagGroup.List>
                  {selectedModifiers.map((group) => (
                    <Tag key={group.id} id={group.id} textValue={group.name}>
                      {group.name}
                      <Tag.RemoveButton>
                        <Xmark className="size-3" />
                      </Tag.RemoveButton>
                    </Tag>
                  ))}
                </TagGroup.List>
              </TagGroup>
            )}

            {availableModifiers.length > 0 && (
              <Dropdown>
                <Button size="sm" variant="secondary" isDisabled={submitting}>
                  <Plus className="size-4" />
                  Add modifier
                </Button>
                <Dropdown.Popover>
                  <Dropdown.Menu
                    onAction={(key) => applyModifierIds([...modifierGroupIds, String(key)])}
                  >
                    {availableModifiers.map((group) => (
                      <Dropdown.Item key={group.id} id={group.id} textValue={group.name}>
                        <Label>{group.name}</Label>
                        <span className="text-xs text-muted">
                          {[...group.modifier_values]
                            .sort((a, b) => a.position - b.position)
                            .map((value) => {
                              const delta = cents(value.price_delta_cents);
                              return delta === 0
                                ? value.name
                                : `${value.name} +${formatMoney(delta, currency, locale)}`;
                            })
                            .join(", ")}
                        </span>
                      </Dropdown.Item>
                    ))}
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            )}
          </div>
        )}
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col">
            <h3 className="text-sm font-semibold">Variants</h3>
            <p className="text-xs text-muted">
              {variantArray.fields.length} variant
              {variantArray.fields.length === 1 ? "" : "s"} · prices in store currency
            </p>
          </div>
          {selectedOptions.length === 0 && (
            <Button
              size="sm"
              variant="tertiary"
              onPress={() => variantArray.append(emptyVariant("Default"))}
            >
              Add variant
            </Button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-separate border-spacing-y-1 text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="pe-3 pb-1 font-medium">Variant</th>
                {variantImage && <th className="pe-3 pb-1 font-medium">Image</th>}
                <th className="pe-3 pb-1 font-medium">Price</th>
                <th className="pe-3 pb-1 font-medium">Compare at</th>
                <th className="pe-3 pb-1 font-medium">SKU</th>
                <th className="pe-3 pb-1 font-medium">Barcode</th>
                <th className="pe-3 pb-1 font-medium">Weight (g)</th>
                <th className="pe-3 pb-1 font-medium">Cost</th>
                <th className="pe-3 pb-1 font-medium">Ships</th>
                <th className="pe-3 pb-1 font-medium">Tax</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {variantArray.fields.map((variant, index) => (
                <tr key={variant.key}>
                  <td className="pe-3 align-middle font-medium">{variant.title}</td>
                  {variantImage && (
                    <td className="pe-3 align-middle">{variantImage(variant, index)}</td>
                  )}
                  <td className="pe-3">
                    <Controller
                      control={control}
                      name={`variants.${index}.price`}
                      render={({ field, fieldState }) => (
                        <>
                          <Input
                            aria-label={`${variant.title} price`}
                            className="w-24"
                            aria-invalid={fieldState.invalid}
                            value={field.value}
                            onBlur={field.onBlur}
                            onChange={(event) => field.onChange(event.target.value)}
                          />
                          {fieldState.error && (
                            <p className="mt-1 text-xs text-danger">{fieldState.error.message}</p>
                          )}
                        </>
                      )}
                    />
                  </td>
                  <td className="pe-3">
                    <Controller
                      control={control}
                      name={`variants.${index}.compareAt`}
                      render={({ field, fieldState }) => (
                        <>
                          <Input
                            aria-label={`${variant.title} compare at price`}
                            className="w-24"
                            aria-invalid={fieldState.invalid}
                            value={field.value}
                            onBlur={field.onBlur}
                            onChange={(event) => field.onChange(event.target.value)}
                          />
                          {fieldState.error && (
                            <p className="mt-1 text-xs text-danger">{fieldState.error.message}</p>
                          )}
                        </>
                      )}
                    />
                  </td>
                  <td className="pe-3">
                    <Controller
                      control={control}
                      name={`variants.${index}.sku`}
                      render={({ field }) => (
                        <Input
                          aria-label={`${variant.title} SKU`}
                          className="w-32"
                          value={field.value}
                          onBlur={field.onBlur}
                          onChange={(event) => field.onChange(event.target.value)}
                        />
                      )}
                    />
                  </td>
                  <td className="pe-3">
                    <Controller
                      control={control}
                      name={`variants.${index}.barcode`}
                      render={({ field }) => (
                        <Input
                          aria-label={`${variant.title} barcode`}
                          className="w-32"
                          value={field.value}
                          onBlur={field.onBlur}
                          onChange={(event) => field.onChange(event.target.value)}
                        />
                      )}
                    />
                  </td>
                  <td className="pe-3">
                    <Controller
                      control={control}
                      name={`variants.${index}.weightGrams`}
                      render={({ field, fieldState }) => (
                        <>
                          <Input
                            aria-label={`${variant.title} weight`}
                            className="w-20"
                            aria-invalid={fieldState.invalid}
                            value={field.value}
                            onBlur={field.onBlur}
                            onChange={(event) => field.onChange(event.target.value)}
                          />
                          {fieldState.error && (
                            <p className="mt-1 text-xs text-danger">{fieldState.error.message}</p>
                          )}
                        </>
                      )}
                    />
                  </td>
                  <td className="pe-3">
                    <Controller
                      control={control}
                      name={`variants.${index}.cost`}
                      render={({ field, fieldState }) => (
                        <>
                          <Input
                            aria-label={`${variant.title} cost`}
                            className="w-24"
                            aria-invalid={fieldState.invalid}
                            value={field.value}
                            onBlur={field.onBlur}
                            onChange={(event) => field.onChange(event.target.value)}
                          />
                          {fieldState.error && (
                            <p className="mt-1 text-xs text-danger">{fieldState.error.message}</p>
                          )}
                        </>
                      )}
                    />
                  </td>
                  <td className="pe-3">
                    <Controller
                      control={control}
                      name={`variants.${index}.requiresShipping`}
                      render={({ field }) => (
                        <Checkbox
                          aria-label={`${variant.title} requires shipping`}
                          isSelected={field.value}
                          onChange={field.onChange}
                        >
                          <Checkbox.Content>
                            <Checkbox.Control>
                              <Checkbox.Indicator />
                            </Checkbox.Control>
                          </Checkbox.Content>
                        </Checkbox>
                      )}
                    />
                  </td>
                  <td className="pe-3">
                    <div className="flex flex-col items-center gap-1">
                      <Controller
                        control={control}
                        name={`variants.${index}.taxable`}
                        render={({ field }) => (
                          <Checkbox
                            aria-label={`${variant.title} taxable`}
                            isSelected={field.value}
                            onChange={field.onChange}
                          >
                            <Checkbox.Content>
                              <Checkbox.Control>
                                <Checkbox.Indicator />
                              </Checkbox.Control>
                            </Checkbox.Content>
                          </Checkbox>
                        )}
                      />
                      <Controller
                        control={control}
                        name={`variants.${index}.taxRate`}
                        render={({ field, fieldState }) => (
                          <Input
                            aria-label={`${variant.title} tax rate`}
                            className="w-14"
                            placeholder="auto"
                            aria-invalid={fieldState.invalid}
                            value={field.value}
                            onBlur={field.onBlur}
                            onChange={(event) => field.onChange(event.target.value)}
                          />
                        )}
                      />
                    </div>
                  </td>
                  <td>
                    <Button
                      aria-label={`Remove ${variant.title}`}
                      isIconOnly
                      size="sm"
                      variant="tertiary"
                      isDisabled={variantArray.fields.length === 1}
                      onPress={() => variantArray.remove(index)}
                    >
                      <Xmark className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </form>
  );
}
