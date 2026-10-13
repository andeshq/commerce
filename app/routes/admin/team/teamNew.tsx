import { Button, Card } from "@heroui/react";
import { type ActionFunctionArgs, redirect, useFetcher } from "react-router";
import { getSession } from "@/lib/auth";
import { PageHeader } from "@/lib/page-header";
import { TEAM_FORM_ID, TeamCreateForm, useCreateTeamForm } from "@/lib/team-form";
import { type UserCreateValues, userCreateSchema } from "@/lib/user-schema";
import { createTeamUser, userErrorMessages } from "@/lib/users";
import { m } from "@/paraglide/messages.js";

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
    return { errors: userErrorMessages(error) };
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
        title={m.team_new_title()}
        description={m.team_new_description()}
        actions={
          <>
            <Button variant="secondary" isDisabled={submitting} onPress={() => history.back()}>
              {m.common_cancel()}
            </Button>
            <Button
              type="submit"
              form={TEAM_FORM_ID}
              isDisabled={submitting || !isValid}
              isPending={submitting}
            >
              {submitting ? m.team_creating() : m.team_create()}
            </Button>
          </>
        }
      />

      <Card>
        <Card.Content>
          <TeamCreateForm form={form} submitting={submitting} errors={errors} onSubmit={submit} />
        </Card.Content>
      </Card>
    </div>
  );
}

/* React Router lazy-route contract. */
export { TeamNew as Component, teamNewAction as action, teamNewLoader as loader };
