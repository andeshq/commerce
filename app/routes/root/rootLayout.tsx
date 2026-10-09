import { Outlet, useNavigate } from "react-router";
import { RouterProvider as AriaRouterProvider } from "react-aria-components";
import { AuthProvider } from "@/lib/auth-context";

/** Router basename (`/_`), matching Vite's `base`. */
const BASENAME = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Root route: session context for every page, plus React Aria's router bridge
 * so HeroUI `Link`s navigate through React Router instead of reloading. Links
 * carry a basename-aware href (see `lib/link`), which is stripped back to a
 * router-relative path here.
 */
export function RootLayout() {
  const navigate = useNavigate();

  return (
    <AuthProvider>
      <AriaRouterProvider
        navigate={(href) => {
          const to =
            href === BASENAME || href.startsWith(`${BASENAME}/`)
              ? href.slice(BASENAME.length) || "/"
              : href;
          void navigate(to);
        }}
      >
        <Outlet />
      </AriaRouterProvider>
    </AuthProvider>
  );
}
