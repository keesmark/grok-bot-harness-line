import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          CHANNEL_SECRET: "test-channel-secret",
          GROK_WEBHOOK_URL: "https://grok-bot.example/webhook",
          GROK_WEBHOOK_KEY: "test-send-key",
        },
      },
    }),
  ],
});
