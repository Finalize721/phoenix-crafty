import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import legacy from "@vitejs/plugin-legacy";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import solid from "vite-plugin-solid";

// Bump when regenerating the icons; keep the query version in index.html and notify.ts aligned.
const ICON_ASSET_VERSION = "2";
const { version: APP_VERSION } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version: string };
const GIT_COMMIT =
  process.env.GITHUB_SHA ??
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __GIT_COMMIT__: JSON.stringify(GIT_COMMIT),
  },
  plugins: [
    // messages/{en,de}.json → src/paraglide (typed message functions). No
    // backend and no switcher: the browser language decides, English otherwise.
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/paraglide",
      // Paraglide 2's default: one module per locale in the dev server and tests (a few requests),
      // one per message in production builds (tree shaking). v3 would serve virtual modules only Vite
      // can resolve.
      outputStructure:
        process.env.NODE_ENV === "production"
          ? "message-modules"
          : "locale-modules",
      strategy: ["preferredLanguage", "baseLocale"],
    }),
    legacy({
      targets: ["iOS >= 10", "Safari >= 10"],
    }),
    solid(),
    tailwindcss(),
    VitePWA({
      // UpdatePrompt activates new versions, asking first while connected
      registerType: "prompt",
      // Manifest icons are fetched by Chrome during installation or update.
      includeManifestIcons: false,
      // Icons are rendered from scripts/icons/logo.png: bun run icons
      manifest: {
        name: "Crafty Atelier",
        short_name: "Crafty Atelier",
        description:
          "Control Storz & Bickel vaporizers (Volcano Hybrid, Venty, Veazy, Crafty) via Web Bluetooth",
        lang: "en",
        display: "standalone",
        // The native Android splash can use a solid color, not the HTML image.
        theme_color: "#0b1426",
        background_color: "#050414",
        categories: ["utilities", "lifestyle"],
        icons: [
          {
            src: `pwa-192x192.png?v=${ICON_ASSET_VERSION}`,
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: `pwa-512x512.png?v=${ICON_ASSET_VERSION}`,
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: `maskable-512x512.png?v=${ICON_ASSET_VERSION}`,
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^v$/],
        // Fonts belong to the offline copy; the legacy bundles only serve
        // browsers without service workers. Screenshots, the 512 px icons and
        // the Apple touch icon are only read when installing, which needs a
        // connection anyway (pwa-192x192.png stays: notifications use it)
        globPatterns: [
          "**/*.{js,css,html,svg,png,ico,jpg}",
          "**/*latin*.woff2",
        ],
        // The documentation website is published next to the app under /docs/
        // (build.yml); it is not an app route, so the service worker must not
        // answer it with the app's index.html
        navigateFallbackDenylist: [/\/docs\//],
        globIgnores: [
          "**/*-legacy-*.js",
          "screenshots/**",
          "*-512x512.png",
          "apple-touch-icon.png",
        ],
      },
    }),
  ],
});
