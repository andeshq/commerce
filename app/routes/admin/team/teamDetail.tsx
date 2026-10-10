import { Button, Card, Chip, Dropdown, Label } from "@heroui/react";
import { ChevronDown, TrashBin } from "@gravity-ui/icons";
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
import {
  banTeamUser,
  getTeamUser,
  removeTeamUser,
  setTeamPassword,
  setTeamRole,
  teamErrorMessages,
  unbanTeamUser,
  updateTeamProfile,
} from "@/lib/users";

export async function teamDetailLoader({ params }: LoaderFunctionArgs) {
  const user = await getSession();
  if (user?.role !== "admin") throw redirect("/");

  const member = await getTeamUser(String(params.id));
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
      return { errors: teamErrorMessages(error) };
    }
  }

  if (intent === "ban" || intent === "unban") {
    try {
      if (intent === "ban") await banTeamUser(memberId);
      else await unbanTeamUser(memberId);
      return { errors: [] as string[] };
    } catch (error) {
      return { errors: teamErrorMessages(error) };
    }
  }

  if (intent === "remove") {
    try {
      await removeTeamUser(memberId);
      return redirect("/team");
    } catch (error) {
      return { errors: teamErrorMessages(error) };
    }
  }

  return { errors: ["Unknown action."] };
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
    if (!window.confirm(`Remove ${member.name}? This cannot be undone.`)) return;
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
              {member.banned ? "Suspended" : "Active"}
            </Chip>
            <Chip color={role === "admin" ? "accent" : "default"} size="sm" variant="soft">
              {role === "admin" ? "Admin" : "Staff"}
            </Chip>
          </span>
        }
        actions={
          <>
            {!isSelf && (
              <Dropdown>
                <Button variant="secondary" isDisabled={submitting}>
                  Actions
                  <ChevronDown className="size-4 text-muted" />
                </Button>
                <Dropdown.Popover>
                  <Dropdown.Menu
                    onAction={(key) => {
                      if (key === "toggle-ban") act(member.banned ? "unban" : "ban");
                      if (key === "remove") remove();
                    }}
                  >
                    <Dropdown.Item
                      id="toggle-ban"
                      textValue={member.banned ? "Reactivate" : "Suspend"}
                    >
                      <Label>{member.banned ? "Reactivate" : "Suspend"}</Label>
                    </Dropdown.Item>
                    <Dropdown.Item id="remove" textValue="Remove" variant="danger">
                      <TrashBin className="size-4 shrink-0 text-danger" />
                      <Label>Remove</Label>
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            )}
            <Button variant="secondary" isDisabled={submitting} onPress={() => history.back()}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={TEAM_FORM_ID}
              isDisabled={submitting || !isValid}
              isPending={submitting}
            >
              {submitting ? "Saving…" : "Save changes"}
            </Button>
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
