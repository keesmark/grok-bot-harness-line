// POST /webhook。署名を確かめてから、本文をそのまま Grok Bot の Webhook に流す。何も保存しない。
import { BodyTooLargeError, readLimitedBody } from "./body";
import { type Env, type ForwardTarget, forwardTarget } from "./env";
import { hasSignatureShape, verifySignature } from "./signature";

export const WEBHOOK_BODY_LIMIT = 1024 * 1024;

async function forward(target: ForwardTarget, body: Uint8Array, events: number): Promise<void> {
  try {
    const response = await fetch(target.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", [target.headerName]: target.headerValue },
      body,
    });
    if (response.ok) console.log("webhook: 転送", { events, status: response.status });
    else console.error("webhook: 転送先がエラーを返した", { events, status: response.status });
  } catch (error) {
    console.error("webhook: 転送に失敗", { events, error: (error as Error)?.name ?? "unknown" });
  }
}

export async function handleWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const target = forwardTarget(env);
  if (!env.CHANNEL_SECRET || target === null) {
    console.error("webhook: 設定不足（CHANNEL_SECRET / GROK_WEBHOOK_URL / GROK_WEBHOOK_KEY）");
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

  // 「検証」ボタンなど、イベントが空のものは流さない。
  if (events.length > 0) ctx.waitUntil(forward(target, body, events.length));
  return new Response(null, { status: 200 });
}
