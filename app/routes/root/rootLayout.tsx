import { Outlet, useNavigate } from "react-router";
import { RouterProvider as AriaRouterProvider } from "react-aria-components";
import { AuthProvider } from "@/lib/auth-context";

/**
 * Root route: session context for every page, plus React Aria's router bridge
 * so HeroUI `Link`s navigate through React Router instead of reloading.
 */
export function RootLayout() {
  const navigate = useNavigate();

  return (
    <AuthProvider>
      <AriaRouterProvider navigate={(href) => void navigate(href)}>
        <Outlet />
      </AriaRouterProvider>
    </AuthProvider>
  );
}
