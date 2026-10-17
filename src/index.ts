import type { Env } from "./env";
import { handleWebhook } from "./webhook";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    switch (pathname) {
      case "/":
        return new Response("grok-bot-harness-line: ok", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      case "/webhook":
        return handleWebhook(request, env, ctx);
      default:
        return new Response(null, { status: 404 });
    }
  },
} satisfies ExportedHandler<Env>;
