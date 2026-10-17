import { cleanup } from "./cleanup";
import type { Env } from "./env";
import { handleMcp } from "./mcp";
import { handleWebhook } from "./webhook";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    switch (pathname) {
      case "/":
        return new Response("grok-bot-harness-line inbox: ok", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      case "/webhook":
        return handleWebhook(request, env, ctx);
      case "/mcp":
        return handleMcp(request, env);
      default:
        return new Response(null, { status: 404 });
    }
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(cleanup(env));
  },
} satisfies ExportedHandler<Env>;
