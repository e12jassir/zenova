import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

const isWebOrigin =
  window.location.protocol === "https:" ||
  (window.location.protocol === "http:" && window.location.hostname === "localhost");
if ("serviceWorker" in navigator && import.meta.env.PROD && isWebOrigin) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // SW registration ignored
    });
  });
}
