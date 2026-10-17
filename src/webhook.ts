// POST /webhook。?url=…&token=… の宛先に、本文をそのまま流す。何も保存しない。
import { BodyTooLargeError, readLimitedBody } from "./body";
import { type AllowedTarget, type ForwardTarget, targetFromQuery } from "./env";

export const WEBHOOK_BODY_LIMIT = 1024 * 1024;

// LINE の署名はそのまま渡す。確かめたくなったら Grok Bot 側で確かめられる。
async function forward(target: ForwardTarget, body: Uint8Array, signature: string | null, events: number): Promise<void> {
  const headers = signature === null ? target.headers : { ...target.headers, "X-Line-Signature": signature };
  try {
    const response = await fetch(target.url, { method: "POST", headers, body });
    if (response.ok) console.log("webhook: 転送", { events, status: response.status });
    else console.error("webhook: 転送先がエラーを返した", { events, status: response.status });
  } catch (error) {
    console.error("webhook: 転送に失敗", { events, error: (error as Error)?.name ?? "unknown" });
  }
}

export async function handleWebhook(
  request: Request,
  ctx: ExecutionContext,
  allowed?: readonly AllowedTarget[],
): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  // URL にトークンが入るので、URL そのものはログに出さない。
  const result = targetFromQuery(new URL(request.url), allowed);
  if (!result.ok) {
    console.warn("webhook: 転送先の指定が正しくない", { status: result.status });
    return new Response(null, { status: result.status });
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

  let events: unknown[];
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as { events?: unknown };
    events = Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    console.warn("webhook: JSON が読めない");
    return new Response(null, { status: 400 });
  }

  // 「検証」ボタンなど、イベントが空のものは流さない。
  if (events.length > 0) ctx.waitUntil(forward(result.target, body, request.headers.get("X-Line-Signature"), events.length));
  return new Response(null, { status: 200 });
}
