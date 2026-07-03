import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { registerServiceWorker } from "./pwa";
import { loadTheme } from "./theme";
import { loadCustomCss } from "./customcss";
import "highlight.js/styles/github-dark.css";
import "./index.css";

// Apply the saved theme + user CSS *before* the first React paint. Doing this
// in an effect (i.e. after paint) briefly showed the default dark palette and
// then restyled everything — visible as a blink on the login screen.
loadTheme();
loadCustomCss();

registerServiceWorker();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
