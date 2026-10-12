import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { getLocale } from "./paraglide/runtime.js";
import { router } from "./router";
import "./styles/globals.css";

document.documentElement.lang = getLocale();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
