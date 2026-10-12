import { Button, Card } from "@heroui/react";
import { useNavigate } from "react-router";
import { m } from "@/paraglide/messages.js";

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <Card.Header>
          <Card.Title>{m.not_found_title()}</Card.Title>
          <Card.Description>{m.not_found_description()}</Card.Description>
        </Card.Header>
        <Card.Footer>
          <Button onPress={() => navigate("/")}>{m.not_found_back()}</Button>
        </Card.Footer>
      </Card>
    </main>
  );
}
