import { Plus } from "@gravity-ui/icons";
import { Button, Card, Chip, SearchField, Table } from "@heroui/react";
import { useMemo, useState } from "react";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { getSession } from "@/lib/auth";
import { roleLabel } from "@/lib/i18n";
import { Link } from "@/lib/link";
import { PageHeader } from "@/lib/page-header";
import { listTeamUsers } from "@/lib/users";
import { m } from "@/paraglide/messages.js";

export async function teamListingLoader() {
  const user = await getSession();
  if (user?.role !== "admin") throw redirect("/");
  return { members: await listTeamUsers() };
}

export function TeamListing() {
  const { members } = useLoaderData<Awaited<ReturnType<typeof teamListingLoader>>>();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("");

  const rows = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return members;
    return members.filter(
      (member) =>
        member.name.toLowerCase().includes(term) || member.email.toLowerCase().includes(term),
    );
  }, [members, filter]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={m.team_title()}
        description={m.team_description()}
        actions={
          <Button size="sm" onPress={() => navigate("/team/new")}>
            <Plus className="size-4" />
            {m.team_new()}
          </Button>
        }
      />

      <Card>
        <Card.Header className="flex-row flex-wrap items-center justify-between gap-3">
          <SearchField
            aria-label={m.team_search()}
            variant="secondary"
            value={filter}
            onChange={setFilter}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input className="w-44" placeholder={m.common_search()} />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
        </Card.Header>

        <Card.Content>
          {rows.length === 0 ? (
            <p className="mx-auto max-w-md py-12 text-center text-sm text-muted">
              {members.length === 0 ? m.team_empty() : m.team_no_match()}
            </p>
          ) : (
            <Table>
              <Table.ScrollContainer>
                <Table.Content aria-label={m.team_title()} className="min-w-[680px]">
                  <Table.Header>
                    <Table.Column isRowHeader>{m.common_member()}</Table.Column>
                    <Table.Column>{m.common_role()}</Table.Column>
                    <Table.Column>{m.common_status()}</Table.Column>
                    <Table.Column>{m.common_added()}</Table.Column>
                    <Table.Column className="text-end">{m.common_actions()}</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {rows.map((member) => (
                      <Table.Row key={member.id} id={member.id}>
                        <Table.Cell>
                          <Link
                            className="flex flex-col items-start no-underline"
                            href={`/team/${member.id}`}
                          >
                            <span className="font-medium text-foreground">{member.name}</span>
                            <span className="text-xs text-muted">{member.email}</span>
                          </Link>
                        </Table.Cell>
                        <Table.Cell>
                          <Chip
                            color={member.role === "admin" ? "accent" : "default"}
                            size="sm"
                            variant="soft"
                          >
                            {roleLabel(member.role)}
                          </Chip>
                        </Table.Cell>
                        <Table.Cell>
                          <Chip
                            color={member.banned ? "danger" : "success"}
                            size="sm"
                            variant="soft"
                          >
                            {member.banned ? m.common_suspended() : m.common_active()}
                          </Chip>
                        </Table.Cell>
                        <Table.Cell className="text-muted">
                          {new Date(member.createdAt).toLocaleDateString()}
                        </Table.Cell>
                        <Table.Cell className="text-end">
                          <Link
                            className="text-sm font-medium no-underline"
                            href={`/team/${member.id}`}
                          >
                            {m.common_edit()}
                          </Link>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          )}
        </Card.Content>
      </Card>
    </div>
  );
}

/* React Router lazy-route contract. */
export { TeamListing as Component, teamListingLoader as loader };
