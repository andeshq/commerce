import { useMemo, useState } from "react";
import { Button, Card, Chip, SearchField, Table } from "@heroui/react";
import { Link } from "@/lib/link";
import { Plus } from "@gravity-ui/icons";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { PageHeader } from "@/lib/page-header";
import { getSession } from "@/lib/auth";
import { listTeamUsers } from "@/lib/users";

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
        member.name.toLowerCase().includes(term) ||
        member.email.toLowerCase().includes(term),
    );
  }, [members, filter]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Team"
        description="Admins and staff who can sign in to this store."
        actions={
          <Button size="sm" onPress={() => navigate("/team/new")}>
            <Plus className="size-4" />
            New user
          </Button>
        }
      />

      <Card>
        <Card.Header className="flex-row flex-wrap items-center justify-between gap-3">
          <SearchField
            aria-label="Search team"
            variant="secondary"
            value={filter}
            onChange={setFilter}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input className="w-44" placeholder="Search" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
        </Card.Header>

        <Card.Content>
          {rows.length === 0 ? (
            <p className="mx-auto max-w-md py-12 text-center text-sm text-muted">
              {members.length === 0
                ? "No team members yet."
                : "No team members match your search."}
            </p>
          ) : (
            <Table>
              <Table.ScrollContainer>
                <Table.Content aria-label="Team" className="min-w-[680px]">
                  <Table.Header>
                    <Table.Column isRowHeader>Member</Table.Column>
                    <Table.Column>Role</Table.Column>
                    <Table.Column>Status</Table.Column>
                    <Table.Column>Added</Table.Column>
                    <Table.Column className="text-end">Actions</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {rows.map((member) => (
                      <Table.Row key={member.id} id={member.id}>
                        <Table.Cell>
                          <Link
                            className="flex flex-col no-underline"
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
                            {member.role === "admin" ? "Admin" : "Staff"}
                          </Chip>
                        </Table.Cell>
                        <Table.Cell>
                          <Chip
                            color={member.banned ? "danger" : "success"}
                            size="sm"
                            variant="soft"
                          >
                            {member.banned ? "Suspended" : "Active"}
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
                            Edit
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
