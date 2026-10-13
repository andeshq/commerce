import {
  ArrowRightFromSquare,
  Boxes3,
  ChevronDown,
  Cube,
  FolderTree,
  Gear,
  LayoutHeaderCells,
  ListCheck,
  Persons,
  Receipt,
  ShoppingBag,
  Sliders,
} from "@gravity-ui/icons";
import { Avatar, Button, Dropdown, Label, SearchField } from "@heroui/react";
import { type ComponentType, type Key, useEffect, useRef, useState } from "react";
import {
  Outlet,
  redirect,
  useLoaderData,
  useLocation,
  useNavigate,
  useRouteLoaderData,
} from "react-router";
import { getSetupStatus } from "@/lib/api";
import { getSession, isStaff } from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";
import type { Store } from "@/lib/catalog";
import { LanguageSwitcher } from "@/lib/language-switcher";
import { Link } from "@/lib/link";
import { pgbase } from "@/lib/pgbase";
import { m } from "@/paraglide/messages.js";

/**
 * Admin shell loader: staff gate (redirects before the shell renders) plus the
 * store identity every admin page formats with.
 */
export async function adminLoader() {
  // Bootstrap lock: an unconfigured instance can only reach the setup wizard.
  if ((await getSetupStatus()).needsSetup) throw redirect("/setup");

  const user = await getSession();
  if (!user) throw redirect("/sign-in");
  if (!isStaff(user)) throw redirect("/");

  const stores = await pgbase
    .from("store_settings")
    .select("name,currency_code,locale,prices_include_tax,tax_rate_bps,tax_label")
    .limit(1)
    .throwOnError();

  return { store: (stores.data[0] as Store) ?? null };
}

export type AdminLoaderData = Awaited<ReturnType<typeof adminLoader>>;

/** Store identity for pages that format money (read from the admin layout). */
export function useAdminStore(): Store | null {
  const data = useRouteLoaderData("admin") as AdminLoaderData | undefined;
  return data?.store ?? null;
}

interface NavLink {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Hidden from staff; only admins see admin-only destinations. */
  adminOnly?: boolean;
}

interface NavGroup {
  label: string;
  links: NavLink[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: m.nav_general(),
    links: [{ href: "/", label: m.nav_dashboard(), icon: LayoutHeaderCells }],
  },
  {
    label: m.nav_sales(),
    links: [
      { href: "/orders", label: m.nav_orders(), icon: Receipt },
      { href: "/customers", label: m.nav_customers(), icon: Persons, adminOnly: true },
    ],
  },
  {
    label: m.nav_catalog(),
    links: [
      { href: "/products", label: m.nav_products(), icon: Boxes3 },
      { href: "/inventory", label: m.nav_inventory(), icon: Cube },
      { href: "/options", label: m.nav_options(), icon: ListCheck },
      { href: "/modifiers", label: m.nav_modifiers(), icon: Sliders },
      { href: "/categories", label: m.nav_categories(), icon: FolderTree },
    ],
  },
];

const ADMIN_GROUP: NavGroup = {
  label: m.nav_system(),
  links: [
    { href: "/team", label: m.nav_team(), icon: Persons, adminOnly: true },
    { href: "/settings", label: m.nav_settings(), icon: Gear, adminOnly: true },
  ],
};

export function AdminLayout() {
  const { user, signOut } = useAuth();
  const data = useLoaderData<Awaited<ReturnType<typeof adminLoader>>>();
  const { pathname: urlPathname } = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const mainRef = useRef<HTMLElement>(null);

  // The shell scrolls inside <main>; reset it when the route changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: urlPathname intentionally the only dep
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [urlPathname]);

  const storeName = data.store?.name ?? m.app_name();
  const isAdmin = user?.role === "admin";
  const groups = [...NAV_GROUPS, ADMIN_GROUP]
    .map((group) => ({
      ...group,
      links: group.links.filter((link) => !link.adminOnly || isAdmin),
    }))
    .filter((group) => group.links.length > 0);
  const links = groups.flatMap((group) => group.links);
  const initials = (user?.name?.trim() || user?.email || "?").slice(0, 1).toUpperCase();

  async function handleSignOut() {
    await signOut();
    await navigate("/sign-in");
  }

  function handleSearch(value: string) {
    const term = value.trim();
    void navigate(term ? `/products?q=${encodeURIComponent(term)}` : "/products");
  }

  function handleUserAction(key: Key) {
    if (key === "sign-out") void handleSignOut();
  }

  const isActive = (href: string) =>
    href === "/" ? urlPathname === "/" : urlPathname.startsWith(href);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background p-3 lg:p-5">
      <div className="mx-auto flex h-full w-full max-w-[1600px] flex-col gap-3 lg:gap-4">
        <header className="flex shrink-0 items-center gap-3 rounded-3xl bg-surface p-3 shadow-surface lg:px-5">
          <div className="flex items-center gap-2.5 lg:w-56">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <ShoppingBag className="size-4" />
            </span>
            <span className="truncate font-semibold">{storeName}</span>
          </div>

          <div className="hidden flex-1 justify-center md:flex">
            <SearchField
              aria-label={m.nav_search_products()}
              className="w-full max-w-md"
              variant="secondary"
              value={query}
              onChange={setQuery}
              onSubmit={handleSearch}
            >
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder={m.nav_search_products()} />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
          </div>

          <div className="ms-auto flex items-center gap-2">
            <LanguageSwitcher />
            <Dropdown>
              <Button className="h-auto gap-2 rounded-full py-1 pe-2 ps-1" variant="secondary">
                <Avatar size="sm">
                  <Avatar.Fallback>{initials}</Avatar.Fallback>
                </Avatar>
                <span className="hidden flex-col items-start leading-tight sm:flex">
                  <span className="text-sm font-medium">{user?.name || m.common_merchant()}</span>
                  <span className="text-xs text-muted">
                    {user?.role === "admin" ? m.role_admin() : m.role_staff()}
                  </span>
                </span>
                <ChevronDown className="size-4 text-muted" />
              </Button>
              <Dropdown.Popover>
                <Dropdown.Menu onAction={handleUserAction}>
                  <Dropdown.Item id="sign-out" textValue={m.common_sign_out()} variant="danger">
                    <ArrowRightFromSquare className="size-4 shrink-0 text-danger" />
                    <Label>{m.common_sign_out()}</Label>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 items-stretch gap-3 lg:gap-4">
          <aside className="scrollbar-subtle hidden w-60 shrink-0 flex-col gap-5 overflow-y-auto rounded-3xl bg-surface-secondary p-3.5 lg:flex">
            {groups.map((group) => (
              <nav key={group.label} aria-label={group.label} className="flex flex-col gap-1">
                <span className="px-3 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">
                  {group.label}
                </span>
                {group.links.map(({ href, label, icon: Icon }) => {
                  const active = isActive(href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={
                        "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium no-underline transition-colors " +
                        (active
                          ? "bg-accent text-accent-foreground shadow-sm"
                          : "text-muted hover:bg-surface-tertiary hover:text-foreground")
                      }
                    >
                      <Icon className="size-4 shrink-0" />
                      {label}
                    </Link>
                  );
                })}
              </nav>
            ))}

            <div className="mt-auto border-t border-field-border pt-3">
              <Button
                className="w-full justify-start rounded-2xl text-danger"
                variant="tertiary"
                onPress={handleSignOut}
              >
                <ArrowRightFromSquare className="size-4" />
                {m.common_sign_out()}
              </Button>
            </div>
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            <nav className="flex shrink-0 gap-1 overflow-x-auto lg:hidden">
              {links.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={
                    "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap no-underline " +
                    (isActive(href) ? "bg-accent text-accent-foreground" : "bg-surface text-muted")
                  }
                >
                  <Icon className="size-4 shrink-0" />
                  {label}
                </Link>
              ))}
            </nav>

            <main
              ref={mainRef}
              className="scrollbar-subtle -me-3 min-h-0 min-w-0 flex-1 overflow-y-auto pe-3 [scrollbar-gutter:stable] lg:-me-5 lg:pe-5"
            >
              <Outlet />
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}

/* React Router lazy-route contract. */
export { AdminLayout as Component, adminLoader as loader };
