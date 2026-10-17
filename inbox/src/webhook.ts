// POST /webhook。安い確認から先にする。
import { BodyTooLargeError, readLimitedBody } from "./body";
import type { Env } from "./env";
import { hasSignatureShape, verifySignature } from "./signature";
import { saveEvents } from "./store";

export const WEBHOOK_BODY_LIMIT = 1024 * 1024;

export async function handleWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  if (!env.CHANNEL_SECRET) {
    console.error("webhook: 設定不足（CHANNEL_SECRET）");
    return new Response(null, { status: 503 });
  }

  const signature = request.headers.get("X-Line-Signature");
  if (!hasSignatureShape(signature)) {
    console.warn("webhook: 署名の形が違う");
    return new Response(null, { status: 401 });
  }

  let body: Uint8Array;
  try {
    body = await readLimitedBody(request, WEBHOOK_BODY_LIMIT);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      console.warn("webhook: 本文が上限を超えた");
      return new Response(null, { status: 413 });
    }
    throw error;
  }

  if (!(await verifySignature(env.CHANNEL_SECRET, body, signature))) {
    console.warn("webhook: 署名が合わない");
    return new Response(null, { status: 401 });
  }

  let events: unknown[];
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as { events?: unknown };
    events = Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    console.warn("webhook: JSON が読めない");
    return new Response(null, { status: 400 });
  }

  if (events.length > 0) {
    const receivedAt = Date.now();
    ctx.waitUntil(
      saveEvents(env.DB, events, receivedAt).then(
        (result) => console.log("webhook: 保存", { events: events.length, ...result }),
        (error: unknown) =>
          console.error("webhook: 保存に失敗", { events: events.length, error: (error as Error)?.name ?? "unknown" }),
      ),
    );
  }
  return new Response(null, { status: 200 });
}
