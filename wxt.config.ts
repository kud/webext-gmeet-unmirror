import { defineConfig } from "wxt"

export default defineConfig({
  // This extension already shipped as MV3 (host permissions, and the share hook
  // needs a MAIN-world content script), so it keeps WXT's non-default MV3 build
  // for Firefox rather than the pilot's MV2.
  manifestVersion: 3,
  // Every entrypoint imports what it uses. Auto-imports would also rewrite the
  // bare `browser` global, which the content script reads directly.
  imports: false,
  manifest: {
    name: "Gmeet Unmirror",
    description:
      "Hides the Google Meet presentation tile so full-screen sharing doesn't produce an infinite hall of mirrors.",
    browser_specific_settings: {
      gecko: {
        id: "gmeet-unmirror@kud.io",
        strict_min_version: "142.0",
        data_collection_permissions: {
          required: ["none"],
        },
      },
    },
    permissions: ["storage"],
    host_permissions: ["*://meet.google.com/*"],
    icons: {
      48: "icons/icon.svg",
      96: "icons/icon.svg",
      128: "icons/icon.svg",
    },
  },
  vite: () => ({
    build: {
      // Matches strict_min_version, so the minifier leaves color-scheme and
      // the tokens' dark-mode rules as written instead of lowering them.
      cssTarget: "firefox142",
    },
  }),
  zip: {
    excludeSources: ["web-ext-artifacts/**"],
  },
})
