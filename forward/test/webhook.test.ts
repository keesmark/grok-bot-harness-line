import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/env";

const encoder = new TextEncoder();

async function sign(body: string, secret = env.CHANNEL_SECRET!): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return btoa(String.fromCharCode(...mac));
}

async function call(request: Request, overrides: Partial<Env> = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request as Request<unknown, IncomingRequestCfProperties>, { ...env, ...overrides }, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function post(body: string, signature?: string, overrides: Partial<Env> = {}): Promise<Response> {
  return call(
    new Request("https://relay.example/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Line-Signature": signature ?? (await sign(body)) },
      body,
    }),
    overrides,
  );
}

const BODY = JSON.stringify({
  destination: "Uxxxxxxxx",
  events: [{ type: "message", source: { type: "user", userId: "U1" }, message: { id: "1", type: "text", text: "こんにちは🙂" } }],
});

describe("/webhook（forward）", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("正しい署名なら200を返し、本文をそのまま送信キー付きで流す", async () => {
    expect((await post(BODY)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://grok-bot.example/webhook");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-send-key");
    expect(new TextDecoder().decode(init.body as Uint8Array)).toBe(BODY);
  });

  it("ヘッダー名を変えると、そのヘッダーに送信キーをそのまま入れる", async () => {
    await post(BODY, undefined, { GROK_WEBHOOK_KEY_HEADER: "X-Api-Key" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ "X-Api-Key": "test-send-key" });
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("送信キーがなければ、ヘッダーを付けずに URL のまま流す", async () => {
    const url = "https://grok-bot.example/webhook?token=abc";
    expect((await post(BODY, undefined, { GROK_WEBHOOK_URL: url, GROK_WEBHOOK_KEY: "" })).status).toBe(200);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(url);
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("署名が合わなければ401で、流さない", async () => {
    expect((await post(BODY, "a".repeat(43))).status).toBe(401);
    expect((await post(BODY, await sign(BODY, "other"))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("イベントが空なら200で、流さない", async () => {
    expect((await post(JSON.stringify({ destination: "U", events: [] }))).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("JSON が壊れていると400", async () => {
    expect((await post("{oops")).status).toBe(400);
  });

  it("設定が足りないか、転送先が https でなければ503", async () => {
    expect((await post(BODY, undefined, { CHANNEL_SECRET: "" })).status).toBe(503);
    expect((await post(BODY, undefined, { GROK_WEBHOOK_URL: "http://grok-bot.example/webhook" })).status).toBe(503);
    expect((await post(BODY, undefined, { GROK_WEBHOOK_URL: "not a url" })).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("転送先がエラーでも LINE には200を返す", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 401 }));
    expect((await post(BODY)).status).toBe(200);
  });

  it("上限を超える本文は413", async () => {
    const response = await call(
      new Request("https://relay.example/webhook", {
        method: "POST",
        headers: { "X-Line-Signature": await sign(BODY), "Content-Length": String(2 * 1024 * 1024) },
        body: BODY,
      }),
    );
    expect(response.status).toBe(413);
  });

  it("POST 以外は405、知らないパスは404", async () => {
    expect((await call(new Request("https://relay.example/webhook"))).status).toBe(405);
    expect((await call(new Request("https://relay.example/x"))).status).toBe(404);
  });
});
