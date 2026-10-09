import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Description,
  FieldError,
  Input,
  Label,
  ListBox,
  Select,
  Switch,
  TextField,
} from "@heroui/react";
import { redirect, useNavigate } from "react-router";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { getSetupStatus, runSetup, setupErrorMessages } from "@/lib/api";
import {
  CURRENCIES,
  CURRENCY_LABELS,
  LOCALES,
  LOCALE_LABELS,
  type CurrencyCode,
  type LocaleCode,
} from "@/lib/ref-data";

const STEPS = ["Store", "Administrator", "Review"] as const;

/** Per-step schemas gate the wizard buttons; the full schema validates submit. */
const storeStepSchema = z.object({
  storeName: z.string().trim().min(1),
});

const adminStepSchema = z
  .object({
    name: z.string().trim().min(1),
    email: z.email(),
    password: z.string().min(8),
    confirmPassword: z.string().min(1),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
  });

const setupSchema = z
  .object({
    storeName: z.string().trim().min(1, "Enter a store name."),
    currencyCode: z.enum(CURRENCIES),
    locale: z.enum(LOCALES),
    pricesIncludeTax: z.boolean(),
    name: z.string().trim().min(1, "Enter your name."),
    email: z.email("Enter a valid email address."),
    password: z.string().min(8, "Use at least 8 characters."),
    confirmPassword: z.string().min(1, "Confirm your password."),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

type SetupValues = z.infer<typeof setupSchema>;

/** Gate the wizard, redirecting away once the store is set up. */
export async function setupLoader() {
  const { needsSetup } = await getSetupStatus();
  if (!needsSetup) throw redirect("/");
  return null;
}

export function SetupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);

  const {
    control,
    formState: { isSubmitting, isValid },
    handleSubmit,
    watch,
  } = useForm<SetupValues>({
    resolver: zodResolver(setupSchema),
    mode: "onChange",
    defaultValues: {
      storeName: "",
      currencyCode: "COP",
      locale: "es-CO",
      pricesIncludeTax: true,
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const values = watch();
  const storeValid = storeStepSchema.safeParse(values).success;
  const adminValid = adminStepSchema.safeParse(values).success;

  async function submit(data: SetupValues) {
    setErrors([]);
    try {
      await runSetup({
        storeName: data.storeName,
        currencyCode: data.currencyCode,
        locale: data.locale,
        pricesIncludeTax: data.pricesIncludeTax,
        name: data.name,
        email: data.email,
        password: data.password,
      });
      await navigate("/");
    } catch (error) {
      setErrors(setupErrorMessages(error));
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <form className="w-full max-w-lg" onSubmit={handleSubmit(submit)}>
        <Card className="w-full">
          <Card.Header>
            <Card.Title>Set up your store</Card.Title>
            <Card.Description>
              One-time configuration. This page locks once an administrator exists.
            </Card.Description>
          </Card.Header>

          <Card.Content className="flex flex-col gap-6">
            <ol className="flex items-center gap-2 text-sm">
              {STEPS.map((label, index) => (
                <li key={label} className="flex flex-1 items-center gap-2">
                  <span
                    className={
                      "flex size-6 shrink-0 items-center justify-center rounded-full text-xs " +
                      (index <= step
                        ? "bg-accent text-accent-foreground"
                        : "bg-surface-secondary text-muted")
                    }
                  >
                    {index + 1}
                  </span>
                  <span className={index === step ? "font-medium" : "text-muted"}>{label}</span>
                </li>
              ))}
            </ol>

            {errors.length > 0 && (
              <Alert status="danger">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>Setup failed</Alert.Title>
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

            {step === 0 && (
              <div className="flex flex-col gap-4">
                <Controller
                  control={control}
                  name="storeName"
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
                      <Label>Store name</Label>
                      <Input placeholder="Andes" autoComplete="organization" />
                      {fieldState.invalid ? (
                        <FieldError>{fieldState.error?.message}</FieldError>
                      ) : (
                        <Description>Shown on receipts and storefront.</Description>
                      )}
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
                  name="pricesIncludeTax"
                  render={({ field }) => (
                    <Switch name={field.name} isSelected={field.value} onChange={field.onChange}>
                      <Switch.Content>
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                        Prices include tax
                      </Switch.Content>
                    </Switch>
                  )}
                />
              </div>
            )}

            {step === 1 && (
              <div className="flex flex-col gap-4">
                <Controller
                  control={control}
                  name="name"
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
                      <Label>Your name</Label>
                      <Input placeholder="Owner" autoComplete="name" />
                      <FieldError>{fieldState.error?.message}</FieldError>
                    </TextField>
                  )}
                />

                <Controller
                  control={control}
                  name="email"
                  render={({ field, fieldState }) => (
                    <TextField
                      isRequired
                      fullWidth
                      name={field.name}
                      type="email"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      isInvalid={fieldState.invalid}
                    >
                      <Label>Email</Label>
                      <Input placeholder="owner@example.com" autoComplete="username" />
                      <FieldError>{fieldState.error?.message}</FieldError>
                    </TextField>
                  )}
                />

                <Controller
                  control={control}
                  name="password"
                  render={({ field, fieldState }) => (
                    <TextField
                      isRequired
                      fullWidth
                      name={field.name}
                      type="password"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      isInvalid={fieldState.invalid}
                    >
                      <Label>Password</Label>
                      <Input autoComplete="new-password" />
                      {fieldState.invalid ? (
                        <FieldError>{fieldState.error?.message}</FieldError>
                      ) : (
                        <Description>At least 8 characters.</Description>
                      )}
                    </TextField>
                  )}
                />

                <Controller
                  control={control}
                  name="confirmPassword"
                  render={({ field, fieldState }) => (
                    <TextField
                      isRequired
                      fullWidth
                      name={field.name}
                      type="password"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      isInvalid={fieldState.invalid}
                    >
                      <Label>Confirm password</Label>
                      <Input autoComplete="new-password" />
                      <FieldError>{fieldState.error?.message}</FieldError>
                    </TextField>
                  )}
                />
              </div>
            )}

            {step === 2 && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted">Store</dt>
                <dd className="font-medium">{values.storeName.trim() || "—"}</dd>
                <dt className="text-muted">Currency</dt>
                <dd>
                  {values.currencyCode} — {CURRENCY_LABELS[values.currencyCode as CurrencyCode]}
                </dd>
                <dt className="text-muted">Locale</dt>
                <dd>{LOCALE_LABELS[values.locale as LocaleCode]}</dd>
                <dt className="text-muted">Prices</dt>
                <dd>{values.pricesIncludeTax ? "Tax included" : "Tax added at checkout"}</dd>
                <dt className="text-muted">Administrator</dt>
                <dd>{values.name.trim() || "—"}</dd>
                <dt className="text-muted">Email</dt>
                <dd>{values.email.trim() || "—"}</dd>
              </dl>
            )}
          </Card.Content>

          <Card.Footer className="flex justify-between gap-2">
            <Button
              type="button"
              variant="secondary"
              isDisabled={step === 0 || isSubmitting}
              onPress={() => setStep((value) => Math.max(0, value - 1))}
            >
              Back
            </Button>

            {step < STEPS.length - 1 ? (
              <Button
                type="button"
                isDisabled={step === 0 ? !storeValid : !adminValid}
                onPress={() => setStep((value) => value + 1)}
              >
                Continue
              </Button>
            ) : (
              <Button type="submit" isDisabled={!isValid} isPending={isSubmitting}>
                {isSubmitting ? "Setting up…" : "Create store"}
              </Button>
            )}
          </Card.Footer>
        </Card>
      </form>
    </main>
  );
}

/* React Router lazy-route contract. */
export { SetupPage as Component, setupLoader as loader };
