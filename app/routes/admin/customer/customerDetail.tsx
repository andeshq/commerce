import { ChevronDown } from "@gravity-ui/icons";
import { Alert, Button, Card, Chip, Dropdown, Label, Table } from "@heroui/react";
import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  redirect,
  useFetcher,
  useLoaderData,
} from "react-router";
import { getSession } from "@/lib/auth";
import { formatMoney, type Order, type PaymentStatus } from "@/lib/catalog";
import { paymentStatusLabel } from "@/lib/i18n";
import { Link } from "@/lib/link";
import { PageHeader } from "@/lib/page-header";
import { pgbase } from "@/lib/pgbase";
import { banUser, getUser, unbanUser, userErrorMessages } from "@/lib/users";
import { m } from "@/paraglide/messages.js";
import { useAdminStore } from "@/routes/admin/adminLayout";

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
  if (customer?.role !== "customer") throw redirect("/customers");

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
    else return { errors: [m.common_unknown_action()] };
    return { errors: [] as string[] };
  } catch (error) {
    return { errors: userErrorMessages(error) };
  }
}

export function CustomerDetail() {
  const { customer, orders } = useLoaderData<Awaited<ReturnType<typeof customerDetailLoader>>>();
  const store = useAdminStore();
  const fetcher = useFetcher<typeof customerDetailAction>();

  const submitting = fetcher.state !== "idle";
  const errors = fetcher.data?.errors ?? [];
  const suspended = Boolean(customer.banned);

  function act(intent: "suspend" | "reactivate") {
    if (
      intent === "suspend" &&
      !window.confirm(m.customers_suspend_confirm({ name: customer.name }))
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
              {suspended ? m.common_suspended() : m.common_active()}
            </Chip>
          </span>
        }
        actions={
          <>
            <Button variant="secondary" isDisabled={submitting} onPress={() => history.back()}>
              {m.common_back()}
            </Button>
            <Dropdown>
              <Button variant="secondary" isDisabled={submitting}>
                {m.common_actions()}
                <ChevronDown className="size-4 text-muted" />
              </Button>
              <Dropdown.Popover>
                <Dropdown.Menu onAction={() => act(suspended ? "reactivate" : "suspend")}>
                  <Dropdown.Item
                    id="toggle"
                    textValue={suspended ? m.customers_reactivate() : m.customers_suspend()}
                  >
                    <Label>{suspended ? m.customers_reactivate() : m.customers_suspend()}</Label>
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
            <Alert.Title>{m.common_could_not_update()}</Alert.Title>
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
          <Card.Title>{m.customers_profile()}</Card.Title>
        </Card.Header>
        <Card.Content className="flex flex-col gap-3 text-sm">
          <div>
            <p className="text-xs text-muted uppercase">{m.common_name()}</p>
            <p>{customer.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted uppercase">{m.common_email()}</p>
            <p>{customer.email}</p>
          </div>
          <div>
            <p className="text-xs text-muted uppercase">{m.common_joined()}</p>
            <p>{new Date(customer.createdAt).toLocaleDateString()}</p>
          </div>
          {suspended && customer.banReason && (
            <div>
              <p className="text-xs text-muted uppercase">{m.customers_suspended_because()}</p>
              <p>{customer.banReason}</p>
            </div>
          )}
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>{m.common_orders()}</Card.Title>
        </Card.Header>
        <Card.Content>
          {orders.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">{m.customers_no_orders()}</p>
          ) : (
            <Table>
              <Table.ScrollContainer>
                <Table.Content aria-label={m.common_orders()} className="min-w-[640px]">
                  <Table.Header>
                    <Table.Column isRowHeader>{m.common_order()}</Table.Column>
                    <Table.Column>{m.common_payment()}</Table.Column>
                    <Table.Column>{m.common_total()}</Table.Column>
                    <Table.Column>{m.common_date()}</Table.Column>
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
                          <Chip
                            color={PAYMENT_COLOR[order.payment_status]}
                            size="sm"
                            variant="soft"
                          >
                            {paymentStatusLabel(order.payment_status)}
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
  customerDetailAction as action,
  customerDetailLoader as loader,
};
