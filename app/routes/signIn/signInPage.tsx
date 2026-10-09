import { useState } from "react";
import { Alert, Button, Card, FieldError, Input, Label, TextField } from "@heroui/react";
import { ShoppingBag } from "@gravity-ui/icons";
import { redirect, useNavigate } from "react-router";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/lib/auth-context";
import { authErrorMessages, getSession, isStaff } from "@/lib/auth";

const signInSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

type SignInValues = z.infer<typeof signInSchema>;

/** Signed-in staff skip the form. */
export async function signInLoader() {
  const user = await getSession();
  if (isStaff(user)) throw redirect("/admin");
  return null;
}

export function SignInPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [errors, setErrors] = useState<string[]>([]);

  const {
    control,
    formState: { isSubmitting, isValid },
    handleSubmit,
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    mode: "onChange",
    defaultValues: { email: "", password: "" },
  });

  async function submit(values: SignInValues) {
    setErrors([]);
    try {
      await signIn(values.email, values.password);
      await navigate("/admin");
    } catch (error) {
      setErrors(authErrorMessages(error));
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <ShoppingBag className="size-4" />
          </span>
          <span className="font-semibold">Commerce</span>
        </div>

        <Card>
          <Card.Header>
            <Card.Title>Sign in</Card.Title>
            <Card.Description>Access the merchant dashboard.</Card.Description>
          </Card.Header>

          <Card.Content className="flex flex-col gap-4">
            {errors.length > 0 && (
              <Alert status="danger">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Description>{errors.join(" ")}</Alert.Description>
                </Alert.Content>
              </Alert>
            )}

            <form className="flex flex-col gap-4" onSubmit={handleSubmit(submit)}>
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
                    <Input autoComplete="current-password" />
                    <FieldError>{fieldState.error?.message}</FieldError>
                  </TextField>
                )}
              />

              <Button
                className="w-full"
                type="submit"
                isDisabled={!isValid}
                isPending={isSubmitting}
              >
                {isSubmitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </Card.Content>

          <Card.Footer className="flex flex-col gap-3">
            <a className="text-center text-sm text-muted hover:text-foreground" href="/">
              Back to store
            </a>
          </Card.Footer>
        </Card>
      </div>
    </main>
  );
}

/* React Router lazy-route contract. */
export { SignInPage as Component, signInLoader as loader };
