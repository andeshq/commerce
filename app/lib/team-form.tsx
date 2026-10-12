import { Controller, useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  Button,
  FieldError,
  Input,
  Label,
  ListBox,
  Select,
  TextField,
} from "@heroui/react";
import {
  generatePassword,
  userCreateSchema,
  userUpdateSchema,
  type UserCreateValues,
  type UserUpdateValues,
} from "./user-schema";
import { roleLabel } from "./i18n";
import { m } from "@/paraglide/messages.js";
import type { TeamRole } from "./users";

/** The detail/new pages submit this form from the page header, outside <form>. */
export const TEAM_FORM_ID = "team-form";

function ErrorAlert({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
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
  );
}

function RoleSelect({
  value,
  onChange,
}: {
  value: TeamRole;
  onChange(value: TeamRole): void;
}) {
  return (
    <Select
      fullWidth
      value={value}
      onChange={(key) => onChange(String(key) as TeamRole)}
    >
      <Label>{m.common_role()}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {(Object.keys({ admin: 1, staff: 1 }) as TeamRole[]).map((role) => (
            <ListBox.Item key={role} id={role} textValue={roleLabel(role)}>
              {roleLabel(role)}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

export function useCreateTeamForm(): UseFormReturn<UserCreateValues> {
  return useForm<UserCreateValues>({
    resolver: zodResolver(userCreateSchema),
    mode: "onChange",
    defaultValues: { name: "", email: "", password: "", role: "staff" },
  });
}

export function TeamCreateForm({
  form,
  submitting,
  errors,
  onSubmit,
}: {
  form: UseFormReturn<UserCreateValues>;
  submitting: boolean;
  errors: string[];
  onSubmit(values: UserCreateValues): void;
}) {
  const { control, setValue } = form;

  return (
    <form
      id={TEAM_FORM_ID}
      className="flex flex-col gap-5"
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <ErrorAlert errors={errors} />

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">{m.team_details()}</h3>

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
                onChange={field.onChange}
                onBlur={field.onBlur}
                isInvalid={fieldState.invalid}
              >
                <Label>{m.common_name()}</Label>
                <Input placeholder="Ana Gómez" />
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
                type="email"
                name={field.name}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                isInvalid={fieldState.invalid}
              >
                <Label>{m.common_email()}</Label>
                <Input placeholder="ana@example.com" />
                <FieldError>{fieldState.error?.message}</FieldError>
              </TextField>
            )}
          />
        </div>

        <div className="flex items-end gap-3">
          <Controller
            control={control}
            name="password"
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
                <Label>{m.team_temporary_password()}</Label>
                <Input />
                <FieldError>{fieldState.error?.message}</FieldError>
              </TextField>
            )}
          />
          <Button
            type="button"
            variant="secondary"
            onPress={() => setValue("password", generatePassword(), { shouldValidate: true })}
          >
            {m.common_generate()}
          </Button>
        </div>

        <p className="text-xs text-muted">
          {m.team_password_hint()}
        </p>

        <Controller
          control={control}
          name="role"
          render={({ field }) => (
            <RoleSelect value={field.value} onChange={field.onChange} />
          )}
        />
      </section>
    </form>
  );
}

export function useEditTeamForm(initial: {
  name: string;
  email: string;
  role: TeamRole;
}): UseFormReturn<UserUpdateValues> {
  return useForm<UserUpdateValues>({
    resolver: zodResolver(userUpdateSchema),
    mode: "onChange",
    defaultValues: { ...initial, password: "" },
  });
}

export function TeamEditForm({
  form,
  submitting,
  errors,
  onSubmit,
}: {
  form: UseFormReturn<UserUpdateValues>;
  submitting: boolean;
  errors: string[];
  onSubmit(values: UserUpdateValues): void;
}) {
  const { control, setValue } = form;

  return (
    <form
      id={TEAM_FORM_ID}
      className="flex flex-col gap-5"
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <ErrorAlert errors={errors} />

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">{m.team_details()}</h3>

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
                onChange={field.onChange}
                onBlur={field.onBlur}
                isInvalid={fieldState.invalid}
              >
                <Label>{m.common_name()}</Label>
                <Input placeholder="Ana Gómez" />
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
                type="email"
                name={field.name}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                isInvalid={fieldState.invalid}
              >
                <Label>{m.common_email()}</Label>
                <Input placeholder="ana@example.com" />
                <FieldError>{fieldState.error?.message}</FieldError>
              </TextField>
            )}
          />
        </div>

        <Controller
          control={control}
          name="role"
          render={({ field }) => (
            <RoleSelect value={field.value} onChange={field.onChange} />
          )}
        />

        <div className="flex items-end gap-3">
          <Controller
            control={control}
            name="password"
            render={({ field, fieldState }) => (
              <TextField
                fullWidth
                name={field.name}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                isInvalid={fieldState.invalid}
              >
                <Label>{m.team_new_password()}</Label>
                <Input />
                <FieldError>{fieldState.error?.message}</FieldError>
              </TextField>
            )}
          />
          <Button
            type="button"
            variant="secondary"
            onPress={() => setValue("password", generatePassword(), { shouldValidate: true })}
          >
            {m.common_generate()}
          </Button>
        </div>

        <p className="text-xs text-muted">{m.team_edit_password_hint()}</p>
      </section>
    </form>
  );
}
