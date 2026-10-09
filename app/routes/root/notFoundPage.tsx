import { Button, Card } from "@heroui/react";
import { useNavigate } from "react-router";

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <Card.Header>
          <Card.Title>Page not found</Card.Title>
          <Card.Description>That address does not exist in this app.</Card.Description>
        </Card.Header>
        <Card.Footer>
          <Button onPress={() => navigate("/")}>Back to dashboard</Button>
        </Card.Footer>
      </Card>
    </main>
  );
}
