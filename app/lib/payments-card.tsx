import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  Chip,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  Switch,
  TextField,
} from "@heroui/react";
import { useAuth } from "@/lib/auth-context";

interface ProviderSummary {
  provider: string;
  enabled: boolean;
  mode: "test" | "live";
  configured: boolean;
  position: number;
  is_default: boolean;
}

const MODES = ["test", "live"] as const;

/** Credential fields per provider, mirroring what each gateway expects. */
const CREDENTIAL_FIELDS: Record<
  string,
  Array<{ key: string; label: string; placeholder: string }>
> = {
  wompi: [
    { key: "publicKey", label: "Public key", placeholder: "pub_test_…" },
    { key: "privateKey", label: "Private key", placeholder: "prv_test_…" },
    { key: "integritySecret", label: "Integrity secret", placeholder: "test_integrity_…" },
    { key: "eventsSecret", label: "Events secret", placeholder: "test_events_…" },
  ],
};

/**
 * Payment gateways, admin-only. Credentials live in the database and are never
 * returned by the API (write-only), so this card toggles enable/mode and lets an
 * admin paste the keys for a provider.
 */
export function PaymentsCard() {
  const { user } = useAuth();
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/payments/providers");
    if (!res.ok) {
      setError("Could not load payment providers.");
      return;
    }
    setProviders((await res.json()) as ProviderSummary[]);
  }, []);

  useEffect(() => {
    if (user?.role === "admin") void load();
  }, [user?.role, load]);

  async function update(
    provider: string,
    patch: {
      enabled?: boolean;
      mode?: "test" | "live";
      credentials?: Record<string, string>;
      is_default?: boolean;
    },
  ) {
    setBusy(provider);
    setError(null);
    try {
      const res = await fetch(`/api/payments/providers/${provider}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? "Could not update the provider.");
      }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the provider.");
    } finally {
      setBusy(null);
    }
  }

  function openCredentials(provider: string) {
    setEditing(provider);
    setValues({});
    setError(null);
  }

  async function saveCredentials() {
    if (!editing) return;
    setSaving(true);
    try {
      await update(editing, { credentials: values });
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  if (user?.role !== "admin") return null;

  const fields = editing ? CREDENTIAL_FIELDS[editing] ?? [] : [];
  const complete = fields.length > 0 && fields.every((field) => values[field.key]?.trim());

  return (
    <Card>
      <Card.Header>
        <Card.Title>Payments</Card.Title>
        <Card.Description>
          Gateways customers can pay with. Credentials stay on the server.
        </Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        {error && <p className="text-sm text-danger">{error}</p>}
        {providers.map((provider) => (
          <div
            key={provider.provider}
            className="flex items-center justify-between gap-3 border-b border-field-border pb-4 last:border-b-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium capitalize">{provider.provider}</p>
              <p className="truncate text-xs text-muted">
                {provider.configured ? "Credentials set" : "No credentials"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {provider.is_default ? (
                <Chip size="sm" variant="soft">
                  Default
                </Chip>
              ) : (
                <Button
                  size="sm"
                  variant="tertiary"
                  isDisabled={busy === provider.provider}
                  onPress={() => update(provider.provider, { is_default: true })}
                >
                  Make default
                </Button>
              )}
              {CREDENTIAL_FIELDS[provider.provider] && (
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => openCredentials(provider.provider)}
                >
                  Configure
                </Button>
              )}
              <Select
                aria-label={`${provider.provider} mode`}
                isDisabled={busy === provider.provider}
                value={provider.mode}
                onChange={(value) => update(provider.provider, { mode: value as "test" | "live" })}
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {MODES.map((mode) => (
                      <ListBox.Item key={mode} id={mode} textValue={mode}>
                        {mode}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              <Switch
                isSelected={provider.enabled}
                isDisabled={busy === provider.provider}
                onChange={(value) => update(provider.provider, { enabled: value })}
              >
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <Label>Enabled</Label>
                </Switch.Content>
              </Switch>
            </div>
          </div>
        ))}
      </Card.Content>

      <Modal isOpen={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-[440px]">
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading className="capitalize">{editing} credentials</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="flex flex-col gap-4">
                {fields.map((field) => (
                  <TextField
                    key={field.key}
                    fullWidth
                    isRequired
                    value={values[field.key] ?? ""}
                    onChange={(value) => setValues((prev) => ({ ...prev, [field.key]: value }))}
                  >
                    <Label>{field.label}</Label>
                    <Input placeholder={field.placeholder} />
                  </TextField>
                ))}
                <p className="text-xs text-muted">
                  Secrets are stored on the server and never sent back to the browser.
                </p>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="secondary" isDisabled={saving} onPress={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button isDisabled={saving || !complete} isPending={saving} onPress={saveCredentials}>
                  Save credentials
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </Card>
  );
}
