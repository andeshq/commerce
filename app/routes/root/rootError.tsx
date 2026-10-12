import { Alert, Button, Card } from "@heroui/react";
import { useRouteError } from "react-router";
import { m } from "@/paraglide/messages.js";

/** Root error boundary: route loaders/actions and render errors land here. */
export function RootError() {
  const error = useRouteError();
  const reason =
    error instanceof Error && error.message ? error.message : m.error_load();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <Card.Header>
          <Card.Title>{m.error_title()}</Card.Title>
        </Card.Header>
        <Card.Content>
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{reason}</Alert.Description>
            </Alert.Content>
          </Alert>
        </Card.Content>
        <Card.Footer>
          <Button onPress={() => window.location.reload()}>{m.common_reload()}</Button>
        </Card.Footer>
      </Card>
    </main>
  );
}
