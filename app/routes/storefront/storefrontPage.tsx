import { Button, Card } from "@heroui/react";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { getSetupStatus } from "@/lib/api";
import { pgbase } from "@/lib/pgbase";
import { localeLabel } from "@/lib/ref-data";
import type { Store } from "@/lib/catalog";

/** Send first-run visitors to the wizard, otherwise load the store identity. */
export async function storefrontLoader() {
  const { needsSetup } = await getSetupStatus();
  if (needsSetup) throw redirect("/setup");

  const stores = await pgbase
    .from("store_settings")
    .select("name,currency_code,locale")
    .limit(1)
    .throwOnError();

  return { store: (stores.data[0] as Store) ?? null };
}

export function StorefrontPage() {
  const { store } = useLoaderData<Awaited<ReturnType<typeof storefrontLoader>>>();
  const navigate = useNavigate();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <Card.Header>
          <Card.Title>{store?.name ?? "Commerce"}</Card.Title>
          <Card.Description>
            {store
              ? `${store.currency_code} · ${localeLabel(store.locale)}`
              : "Your store is ready."}
          </Card.Description>
        </Card.Header>
        <Card.Footer>
          <Button onPress={() => navigate("/admin")}>Merchant dashboard</Button>
        </Card.Footer>
      </Card>
    </main>
  );
}

/* React Router lazy-route contract. */
export { StorefrontPage as Component, storefrontLoader as loader };
