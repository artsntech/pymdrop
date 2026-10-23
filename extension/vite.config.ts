import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

const isFirefox = process.env.BROWSER === "firefox";

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: isFirefox
            ? "manifests/manifest.firefox.json"
            : "manifests/manifest.chrome.json",
          dest: ".",
          rename: "manifest.json",
        },
      ],
    }),
  ],

  build: {
    outDir: isFirefox ? "dist-firefox" : "dist",
    emptyOutDir: true,

    rollupOptions: {
      input: {
        index: "index.html",
        options: "options.html",
        background: "src/background.ts",
        content: "src/content.ts",
      },

      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "background") return "background.js";
          if (chunkInfo.name === "content") return "content.js";
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
});