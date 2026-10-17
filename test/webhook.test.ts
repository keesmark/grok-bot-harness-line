import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { handleWebhook } from "../src/webhook";

const TARGET = "https://api2.cursor.sh/automations/webhook/abc123";

function webhookUrl(params: Record<string, string> = { url: TARGET, token: "send-key" }): string {
  return `https://relay.example/webhook?${new URLSearchParams(params)}`;
}

async function post(
  body: string,
  { url = webhookUrl(), signature }: { url?: string; signature?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature !== undefined) headers["X-Line-Signature"] = signature;
  const ctx = createExecutionContext();
  const response = await handleWebhook(new Request(url, { method: "POST", headers, body }), ctx);
  await waitOnExecutionContext(ctx);
  return response;
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

  it("クエリの url に、token を Bearer で付けて本文をそのまま流す", async () => {
    expect((await post(BODY)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TARGET);
    expect(init.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer send-key" });
    expect(new TextDecoder().decode(init.body as Uint8Array)).toBe(BODY);
  });

  it("url か token がない、url が読めないときは400で、流さない", async () => {
    expect((await post(BODY, { url: webhookUrl({ url: TARGET }) })).status).toBe(400);
    expect((await post(BODY, { url: webhookUrl({ token: "k" }) })).status).toBe(400);
    expect((await post(BODY, { url: webhookUrl({ url: "not a url", token: "k" }) })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Grok Bot の Webhook 以外の宛先は403で、流さない", async () => {
    for (const target of [
      "https://evil.example/automations/webhook/abc",
      "https://api2.cursor.sh.evil.example/automations/webhook/abc",
      "http://api2.cursor.sh/automations/webhook/abc",
      "https://api2.cursor.sh/other/path",
      "https://api2.cursor.sh/automations/webhook/",
      "https://api2.cursor.sh:8443/automations/webhook/abc",
      "https://user:pass@api2.cursor.sh/automations/webhook/abc",
    ]) {
      expect((await post(BODY, { url: webhookUrl({ url: target, token: "k" }) })).status, target).toBe(403);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("LINE の署名ヘッダーがあれば、そのまま渡す", async () => {
    await post(BODY, { signature: "sig-value" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ "X-Line-Signature": "sig-value", Authorization: "Bearer send-key" });
  });

  it("イベントが空なら200で、流さない", async () => {
    expect((await post(JSON.stringify({ destination: "U", events: [] }))).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("JSON が壊れていると400", async () => {
    expect((await post("{oops")).status).toBe(400);
  });

  it("転送先がエラーでも LINE には200を返す", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 401 }));
    expect((await post(BODY)).status).toBe(200);
  });

  it("上限を超える本文は413", async () => {
    const ctx = createExecutionContext();
    const request = new Request(webhookUrl(), { method: "POST", headers: { "Content-Length": String(2 * 1024 * 1024) }, body: BODY });
    expect((await handleWebhook(request, ctx)).status).toBe(413);
  });

  it("POST 以外は405、知らないパスは404", async () => {
    const call = (url: string) =>
      worker.fetch(new Request(url) as Request<unknown, IncomingRequestCfProperties>, {}, createExecutionContext());
    expect((await call(webhookUrl())).status).toBe(405);
    expect((await call("https://relay.example/x")).status).toBe(404);
  });
});
