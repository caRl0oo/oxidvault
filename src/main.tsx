// SPDX-FileCopyrightText: 2026 Pascal Kuhn <support@oxidvault.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@/lib/i18n";
import { initTheme } from "./lib/theme";
import "./styles/globals.css";

initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
