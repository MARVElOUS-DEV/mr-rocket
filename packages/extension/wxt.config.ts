import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "MR-Rocket Auth Helper",
    description: "Syncs CDP authentication for MR-Rocket CLI",
    version: "1.0.0",
    permissions: ["cookies", "nativeMessaging", "storage"],
    host_permissions: ["<all_urls>"],
  },
  runner: {
    startUrls: ["https://example.com"],
  },
});
