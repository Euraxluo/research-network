import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// M2: multi-page build. Output lands in ../.vercel-shell so Vercel serves the
// Vite-built login/account/workbench pages as static files (Vercel checks static
// output before the catch-all Walrus rewrite). auth/* + zklogin-browser.js are
// produced separately by buildVercelAuthShell and must already be present in the
// output dir, so we set emptyOutDir:false to avoid wiping them.
export default defineConfig({
  plugins: [react()],
  // Vite root is web/. Resolve repo-relative paths for the build output.
  build: {
    outDir: resolve(__dirname, "..", ".vercel-shell"),
    emptyOutDir: false,
    // Keep asset filenames stable and content-hashed for JS/CSS chunks.
    rollupOptions: {
      input: {
        login: resolve(__dirname, "login.html"),
        account: resolve(__dirname, "account.html"),
        debug: resolve(__dirname, "debug.html"),
        workbench: resolve(__dirname, "workbench.html")
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  },
  server: {
    port: 5173,
    // Proxy the API + auth assets to the production host in dev so login/account
    // can exercise the real Vercel functions and the bundled zklogin-browser.js.
    proxy: {
      "/api": { target: "https://research-network-web.vercel.app", changeOrigin: true },
      "/auth": { target: "https://research-network-web.vercel.app", changeOrigin: true },
      "/zklogin-browser.js": { target: "https://research-network-web.vercel.app", changeOrigin: true },
      "/styles.css": { target: "https://research-network-web.vercel.app", changeOrigin: true }
    }
  }
});
