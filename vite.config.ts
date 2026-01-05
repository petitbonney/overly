import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  base: "/overly",
  plugins: [preact()],
  server: {
    host: true, // Needed for Docker/WSL to be accessible externally
    watch: {
      usePolling: true, // Needed if file changes aren't detected (e.g., in some WSL setups)
    },
  },
});
