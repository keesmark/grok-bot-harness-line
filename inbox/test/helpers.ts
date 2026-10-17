import { env } from "cloudflare:test";
import worker from "../src/index";
import type { Env } from "../src/env";

export const testEnv = env as unknown as Env;
export const READ_KEY = testEnv.READ_API_KEY!;

const encoder = new TextEncoder();

export async function sign(body: string | Uint8Array, secret = testEnv.CHANNEL_SECRET!): Promise<string> {
  const bytes = typeof body === "string" ? encoder.encode(body) : body;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes));
  return btoa(String.fromCharCode(...mac));
}

export async function call(request: Request, overrides: Partial<Env> = {}): Promise<Response> {
  return worker.fetch(request as Request<unknown, IncomingRequestCfProperties>, { ...testEnv, ...overrides } as Env);
}

export async function postWebhook(body: string, signature?: string, overrides: Partial<Env> = {}): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  headers["X-Line-Signature"] = signature ?? (await sign(body));
  return call(new Request("https://relay.example/webhook", { method: "POST", headers, body }), overrides);
}

let counter = 0;

export function textEvent(userId: string, text: string, extra: Record<string, unknown> = {}) {
  counter++;
  return {
    type: "message",
    timestamp: 1_790_000_000_000 + counter,
    webhookEventId: `EVT${counter}`,
    deliveryContext: { isRedelivery: false },
    source: { type: "user", userId },
    message: { id: `M${counter}`, type: "text", text },
    ...extra,
  };
}

export function messageEvent(userId: string, message: Record<string, unknown>) {
  counter++;
  return {
    type: "message",
    timestamp: 1_790_000_000_000 + counter,
    webhookEventId: `EVT${counter}`,
    deliveryContext: { isRedelivery: false },
    source: { type: "user", userId },
    message: { id: `M${counter}`, ...message },
  };
}

export function payload(events: unknown[]): string {
  return JSON.stringify({ destination: "Uxxxxxxxx", events });
}

export async function rpc(method: string, params?: unknown, id: number | null = 1, key = READ_KEY) {
  const body = JSON.stringify(id === null ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params });
  return call(
    new Request("https://relay.example/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body,
    }),
  );
}

export async function tool<T = any>(name: string, args: Record<string, unknown> = {}): Promise<{ data: T; isError: boolean; raw: any }> {
  const response = await rpc("tools/call", { name, arguments: args });
  const raw = (await response.json()) as any;
  const text = raw.result.content[0].text as string;
  const isError = raw.result.isError === true;
  return { data: (isError ? text : JSON.parse(text)) as T, isError, raw };
}

export async function resetDb(): Promise<void> {
  await testEnv.DB.batch([testEnv.DB.prepare("DELETE FROM messages"), testEnv.DB.prepare("DELETE FROM contacts"),
    testEnv.DB.prepare("DELETE FROM unsent"),
    testEnv.DB.prepare("DELETE FROM sqlite_sequence"),
  ]);
}
