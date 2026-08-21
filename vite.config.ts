import { defineConfig } from "vite";
import pkg from "./package.json";

// The version is injected into the bundle so scripts/verify-live.mjs can prove
// the deployed page is the build we just shipped, rather than trusting HTTP 200.
export default defineConfig({
  define: {
    __ABYSS_BUILD__: JSON.stringify(pkg.version),
  },
});
