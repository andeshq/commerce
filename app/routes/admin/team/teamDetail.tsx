import { Button, ButtonGroup, Card, Chip, Dropdown, Label } from "@heroui/react";
import { EllipsisVertical, TrashBin } from "@gravity-ui/icons";
import {
  redirect,
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { getSession } from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/lib/page-header";
import { TEAM_FORM_ID, TeamEditForm, useEditTeamForm } from "@/lib/team-form";
import { userUpdateSchema, type UserUpdateValues } from "@/lib/user-schema";
import { roleLabel } from "@/lib/i18n";
import { m } from "@/paraglide/messages.js";
import {
  banUser,
  getUser,
  removeTeamUser,
  setTeamPassword,
  setTeamRole,
  unbanUser,
  updateTeamProfile,
  userErrorMessages,
} from "@/lib/users";

export async function teamDetailLoader({ params }: LoaderFunctionArgs) {
  const user = await getSession();
  if (user?.role !== "admin") throw redirect("/");

  const member = await getUser(String(params.id));
  if (!member) throw redirect("/team");

  return { member };
}

export async function teamDetailAction({ request, params }: ActionFunctionArgs) {
  const memberId = String(params.id);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "update") {
    const values = JSON.parse(String(formData.get("payload"))) as UserUpdateValues;
    const parsed = userUpdateSchema.safeParse(values);
    if (!parsed.success) {
      return { errors: parsed.error.issues.map((issue) => issue.message) };
    }

    try {
      await updateTeamProfile(memberId, {
        name: parsed.data.name,
        email: parsed.data.email.trim().toLowerCase(),
      });
      await setTeamRole(memberId, parsed.data.role);
      if (parsed.data.password) {
        await setTeamPassword(memberId, parsed.data.password);
      }
      return redirect("/team");
    } catch (error) {
      return { errors: userErrorMessages(error) };
    }
  }

  if (intent === "ban" || intent === "unban") {
    try {
      if (intent === "ban") await banUser(memberId);
      else await unbanUser(memberId);
      return { errors: [] as string[] };
    } catch (error) {
      return { errors: userErrorMessages(error) };
    }
  }

  if (intent === "remove") {
    try {
      await removeTeamUser(memberId);
      return redirect("/team");
    } catch (error) {
      return { errors: userErrorMessages(error) };
    }
  }

  return { errors: [m.common_unknown_action()] };
}

export function TeamDetail() {
  const { member } = useLoaderData<Awaited<ReturnType<typeof teamDetailLoader>>>();
  const { user } = useAuth();
  const fetcher = useFetcher<typeof teamDetailAction>();

  const submitting = fetcher.state !== "idle";
  const errors = fetcher.data?.errors ?? [];
  const isSelf = member.id === user?.id;
  const role = member.role === "admin" ? "admin" : "staff";

  const form = useEditTeamForm({
    name: member.name,
    email: member.email,
    role,
  });
  const { isValid } = form.formState;

  function submit(values: UserUpdateValues) {
    const formData = new FormData();
    formData.set("intent", "update");
    formData.set("payload", JSON.stringify(values));
    fetcher.submit(formData, { method: "post" });
  }

  function act(intent: "ban" | "unban") {
    const formData = new FormData();
    formData.set("intent", intent);
    fetcher.submit(formData, { method: "post" });
  }

  function remove() {
    if (!window.confirm(m.team_remove_confirm({ name: member.name }))) return;
    const formData = new FormData();
    formData.set("intent", "remove");
    fetcher.submit(formData, { method: "post" });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={member.name}
        description={
          <span className="flex items-center gap-2">
            {member.email}
            <Chip color={member.banned ? "danger" : "success"} size="sm" variant="soft">
              {member.banned ? m.common_suspended() : m.common_active()}
            </Chip>
            <Chip color={role === "admin" ? "accent" : "default"} size="sm" variant="soft">
              {roleLabel(role)}
            </Chip>
          </span>
        }
        actions={
          <>
            <Button variant="secondary" isDisabled={submitting} onPress={() => history.back()}>
              {m.common_cancel()}
            </Button>
            <ButtonGroup>
              <Button
                type="submit"
                form={TEAM_FORM_ID}
                isDisabled={submitting || !isValid}
                isPending={submitting}
              >
                {submitting ? m.common_saving() : m.common_save()}
              </Button>
              {!isSelf && (
                <Dropdown>
                  <Button isIconOnly aria-label={m.common_more_actions()} isDisabled={submitting}>
                    <ButtonGroup.Separator />
                    <EllipsisVertical className="size-4" />
                  </Button>
                  <Dropdown.Popover placement="bottom end">
                    <Dropdown.Menu
                      onAction={(key) => {
                        if (key === "toggle-ban") act(member.banned ? "unban" : "ban");
                        if (key === "remove") remove();
                      }}
                    >
                      <Dropdown.Item
                        id="toggle-ban"
                        textValue={member.banned ? m.customers_reactivate() : m.customers_suspend()}
                      >
                        <Label>{member.banned ? m.customers_reactivate() : m.customers_suspend()}</Label>
                      </Dropdown.Item>
                      <Dropdown.Item id="remove" textValue={m.team_remove()} variant="danger">
                        <TrashBin className="size-4 shrink-0 text-danger" />
                        <Label>{m.team_remove()}</Label>
                      </Dropdown.Item>
                    </Dropdown.Menu>
                  </Dropdown.Popover>
                </Dropdown>
              )}
            </ButtonGroup>
          </>
        }
      />

      <Card>
        <Card.Content>
          <TeamEditForm
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
export { TeamDetail as Component, teamDetailLoader as loader, teamDetailAction as action };
