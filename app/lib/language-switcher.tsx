import { Globe } from "@gravity-ui/icons";
import { Button, Dropdown, Label } from "@heroui/react";
import { m } from "@/paraglide/messages.js";
import { getLocale, type Locale, locales, setLocale } from "@/paraglide/runtime.js";

/** Endonyms: each language is always shown in its own language. */
const LOCALE_LABELS: Record<string, string> = { en: "English", es: "Español" };

/**
 * Locale picker. `setLocale` writes the cookie and reloads the document (its
 * default), so every compiled message re-renders in the new language.
 */
export function LanguageSwitcher() {
  return (
    <Dropdown>
      <Button isIconOnly variant="secondary" aria-label={m.common_language()}>
        <Globe className="size-4" />
      </Button>
      <Dropdown.Popover placement="bottom end">
        <Dropdown.Menu
          selectionMode="single"
          selectedKeys={[getLocale()]}
          onAction={(key) => setLocale(key as Locale)}
        >
          {locales.map((locale) => (
            <Dropdown.Item key={locale} id={locale} textValue={LOCALE_LABELS[locale]}>
              <Label>{LOCALE_LABELS[locale]}</Label>
              <Dropdown.ItemIndicator />
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
