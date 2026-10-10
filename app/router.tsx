import { createBrowserRouter } from "react-router";
import { RootError } from "./routes/root/rootError";
import { RootLayout } from "./routes/root/rootLayout";
import { NotFoundPage } from "./routes/root/notFoundPage";

/**
 * Route tree, mounted under the app base (`/_`). Route modules are loaded
 * lazily (`lazy: () => import(...)`) and export the React Router contract —
 * `Component` plus optional `loader` / `action` — so each route (and its
 * form/table code) is its own chunk.
 */
export const router = createBrowserRouter(
  [
    {
      path: "/",
      Component: RootLayout,
      ErrorBoundary: RootError,
      children: [
        { path: "setup", lazy: () => import("./routes/setup/setupPage") },
        { path: "sign-in", lazy: () => import("./routes/signIn/signInPage") },
        {
          // Pathless shell: the admin pages mount at the app root.
          id: "admin",
          lazy: () => import("./routes/admin/adminLayout"),
          children: [
            { index: true, lazy: () => import("./routes/admin/dashboard/dashboardPage") },
            { path: "orders", lazy: () => import("./routes/admin/order/orderListing") },
            { path: "orders/:id", lazy: () => import("./routes/admin/order/orderDetail") },
            { path: "products", lazy: () => import("./routes/admin/product/productListing") },
            { path: "products/new", lazy: () => import("./routes/admin/product/productNew") },
            { path: "products/:id", lazy: () => import("./routes/admin/product/productDetail") },
            { path: "options", lazy: () => import("./routes/admin/option/optionListing") },
            { path: "options/new", lazy: () => import("./routes/admin/option/optionNew") },
            { path: "options/:id", lazy: () => import("./routes/admin/option/optionDetail") },
            { path: "modifiers", lazy: () => import("./routes/admin/modifier/modifierListing") },
            { path: "modifiers/new", lazy: () => import("./routes/admin/modifier/modifierNew") },
            { path: "modifiers/:id", lazy: () => import("./routes/admin/modifier/modifierDetail") },
            { path: "categories", lazy: () => import("./routes/admin/category/categoryListing") },
            { path: "categories/new", lazy: () => import("./routes/admin/category/categoryNew") },
            { path: "categories/:id", lazy: () => import("./routes/admin/category/categoryDetail") },
            { path: "inventory", lazy: () => import("./routes/admin/inventory/inventoryListing") },
            { path: "team", lazy: () => import("./routes/admin/team/teamListing") },
            { path: "team/new", lazy: () => import("./routes/admin/team/teamNew") },
            { path: "team/:id", lazy: () => import("./routes/admin/team/teamDetail") },
            { path: "settings", lazy: () => import("./routes/admin/settings/settingsPage") },
          ],
        },
        { path: "*", Component: NotFoundPage },
      ],
    },
  ],
  // Vite's `base` is `/_/`; the router basename is the same without the slash.
  { basename: import.meta.env.BASE_URL.replace(/\/$/, "") || "/" },
);
