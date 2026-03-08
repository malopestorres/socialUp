import { loadBackendEnv } from "./env-loader.js";

loadBackendEnv();
await import("./index.js");

