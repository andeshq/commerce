import { Alert, Button, Card, Chip, Dropdown, Label, Table } from "@heroui/react";
import { ChevronDown } from "@gravity-ui/icons";
import {
  redirect,
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { Link } from "@/lib/link";
import { getSession } from "@/lib/auth";
import { PageHeader } from "@/lib/page-header";
import { useAdminStore } from "@/routes/admin/adminLayout";
import { pgbase } from "@/lib/pgbase";
import { banUser, getUser, unbanUser, userErrorMessages } from "@/lib/users";
import { formatMoney, type Order, type PaymentStatus } from "@/lib/catalog";

const PAYMENT_COLOR: Record<PaymentStatus, "success" | "warning" | "danger" | "default"> = {
  paid: "success",
  pending: "warning",
  authorized: "warning",
  failed: "danger",
  refunded: "default",
  partially_refunded: "default",
  voided: "danger",
};

export async function customerDetailLoader({ params }: LoaderFunctionArgs) {
  const user = await getSession();
  if (user?.role !== "admin") throw redirect("/");

  const id = String(params.id);
  const [customer, orders] = await Promise.all([
    getUser(id),
    pgbase
      .from("orders")
      .select("id,number,status,payment_status,total_cents,placed_at")
      .eq("customer_id", id)
      .order("placed_at", { ascending: false })
      .throwOnError(),
  ]);

  // Staff/admin ids are not customers; keep this page to storefront accounts.
  if (!customer || customer.role !== "customer") throw redirect("/customers");

  return { customer, orders: (orders.data ?? []) as Order[] };
}

export async function customerDetailAction({ request, params }: ActionFunctionArgs) {
  const user = await getSession();
  if (user?.role !== "admin") throw redirect("/");

  const id = String(params.id);
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "suspend") await banUser(id);
    else if (intent === "reactivate") await unbanUser(id);
    else return { errors: ["Unknown action."] };
    return { errors: [] as string[] };
  } catch (error) {
    return { errors: userErrorMessages(error) };
  }
}

export function CustomerDetail() {
  const { customer, orders } =
    useLoaderData<Awaited<ReturnType<typeof customerDetailLoader>>>();
  const store = useAdminStore();
  const fetcher = useFetcher<typeof customerDetailAction>();

  const submitting = fetcher.state !== "idle";
  const errors = fetcher.data?.errors ?? [];
  const suspended = Boolean(customer.banned);

  function act(intent: "suspend" | "reactivate") {
    if (
      intent === "suspend" &&
      !window.confirm(
        `Suspend ${customer.name}? They will be signed out and blocked from signing in.`,
      )
    ) {
      return;
    }
    const formData = new FormData();
    formData.set("intent", intent);
    fetcher.submit(formData, { method: "post" });
  }

  const money = (value: string | number) =>
    store ? formatMoney(value, store.currency_code, store.locale) : String(value);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={customer.name}
        description={
          <span className="flex items-center gap-2">
            {customer.email}
            <Chip color={suspended ? "danger" : "success"} size="sm" variant="soft">
              {suspended ? "Suspended" : "Active"}
            </Chip>
          </span>
        }
        actions={
          <>
            <Button variant="secondary" isDisabled={submitting} onPress={() => history.back()}>
              Back
            </Button>
            <Dropdown>
              <Button variant="secondary" isDisabled={submitting}>
                Actions
                <ChevronDown className="size-4 text-muted" />
              </Button>
              <Dropdown.Popover>
                <Dropdown.Menu onAction={() => act(suspended ? "reactivate" : "suspend")}>
                  <Dropdown.Item
                    id="toggle"
                    textValue={suspended ? "Reactivate" : "Suspend"}
                  >
                    <Label>{suspended ? "Reactivate" : "Suspend"}</Label>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </>
        }
      />

      {errors.length > 0 && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Could not update</Alert.Title>
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

      <Card>
        <Card.Header>
          <Card.Title>Profile</Card.Title>
        </Card.Header>
        <Card.Content className="flex flex-col gap-3 text-sm">
          <div>
            <p className="text-xs text-muted uppercase">Name</p>
            <p>{customer.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted uppercase">Email</p>
            <p>{customer.email}</p>
          </div>
          <div>
            <p className="text-xs text-muted uppercase">Joined</p>
            <p>{new Date(customer.createdAt).toLocaleDateString()}</p>
          </div>
          {suspended && customer.banReason && (
            <div>
              <p className="text-xs text-muted uppercase">Suspended because</p>
              <p>{customer.banReason}</p>
            </div>
          )}
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>Orders</Card.Title>
        </Card.Header>
        <Card.Content>
          {orders.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No orders yet.</p>
          ) : (
            <Table>
              <Table.ScrollContainer>
                <Table.Content aria-label="Customer orders" className="min-w-[640px]">
                  <Table.Header>
                    <Table.Column isRowHeader>Order</Table.Column>
                    <Table.Column>Payment</Table.Column>
                    <Table.Column>Total</Table.Column>
                    <Table.Column>Date</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {orders.map((order) => (
                      <Table.Row key={order.id} id={order.id}>
                        <Table.Cell>
                          <Link className="font-medium no-underline" href={`/orders/${order.id}`}>
                            #{order.number}
                          </Link>
                        </Table.Cell>
                        <Table.Cell>
                          <Chip color={PAYMENT_COLOR[order.payment_status]} size="sm" variant="soft">
                            {order.payment_status.replace(/_/g, " ")}
                          </Chip>
                        </Table.Cell>
                        <Table.Cell className="tabular-nums">{money(order.total_cents)}</Table.Cell>
                        <Table.Cell className="text-muted">
                          {new Date(order.placed_at).toLocaleDateString()}
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
export {
  CustomerDetail as Component,
  customerDetailLoader as loader,
  customerDetailAction as action,
};
