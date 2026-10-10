import { Button, Card } from "@heroui/react";
import { redirect, useFetcher, type ActionFunctionArgs } from "react-router";
import { getSession } from "@/lib/auth";
import { PageHeader } from "@/lib/page-header";
import { TEAM_FORM_ID, TeamCreateForm, useCreateTeamForm } from "@/lib/team-form";
import { userCreateSchema, type UserCreateValues } from "@/lib/user-schema";
import { createTeamUser, teamErrorMessages } from "@/lib/users";

export async function teamNewLoader() {
  const user = await getSession();
  if (user?.role !== "admin") throw redirect("/");
  return null;
}

export async function teamNewAction({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const values = JSON.parse(String(formData.get("payload"))) as UserCreateValues;

  const parsed = userCreateSchema.safeParse(values);
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((issue) => issue.message) };
  }

  try {
    await createTeamUser({
      name: parsed.data.name,
      email: parsed.data.email.trim().toLowerCase(),
      password: parsed.data.password,
      role: parsed.data.role,
    });
    return redirect("/team");
  } catch (error) {
    return { errors: teamErrorMessages(error) };
  }
}

export function TeamNew() {
  const fetcher = useFetcher<typeof teamNewAction>();
  const submitting = fetcher.state !== "idle";
  const errors = fetcher.data?.errors ?? [];

  const form = useCreateTeamForm();
  const { isValid } = form.formState;

  function submit(values: UserCreateValues) {
    const formData = new FormData();
    formData.set("payload", JSON.stringify(values));
    fetcher.submit(formData, { method: "post" });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="New team member"
        description="Create a staff or admin account for this store."
        actions={
          <>
            <Button variant="secondary" isDisabled={submitting} onPress={() => history.back()}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={TEAM_FORM_ID}
              isDisabled={submitting || !isValid}
              isPending={submitting}
            >
              {submitting ? "Creating…" : "Create user"}
            </Button>
          </>
        }
      />

      <Card>
        <Card.Content>
          <TeamCreateForm
            form={form}
            submitting={submitting}
            errors={errors}
            onSubmit={submit}
          />
        </Card.Content>
      </Card>
    </div>
  );
}

/* React Router lazy-route contract. */
export { TeamNew as Component, teamNewLoader as loader, teamNewAction as action };
