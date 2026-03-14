import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Elemento #root não encontrado.");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

const bootLoader = document.getElementById("boot-loader");
if (bootLoader) {
  window.requestAnimationFrame(() => {
    bootLoader.classList.add("boot-loader-hidden");
    window.setTimeout(() => {
      bootLoader.remove();
    }, 220);
  });
}
