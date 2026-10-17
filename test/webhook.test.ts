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

describe("/webhook", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("forwards the body unchanged to url with token as a Bearer header", async () => {
    expect((await post(BODY)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TARGET);
    expect(init.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer send-key" });
    expect(new TextDecoder().decode(init.body as Uint8Array)).toBe(BODY);
  });

  it("returns 400 and does not forward when url or token is missing or url is invalid", async () => {
    expect((await post(BODY, { url: webhookUrl({ url: TARGET }) })).status).toBe(400);
    expect((await post(BODY, { url: webhookUrl({ token: "k" }) })).status).toBe(400);
    expect((await post(BODY, { url: webhookUrl({ url: "not a url", token: "k" }) })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 403 and does not forward to anything other than a Grok Bot webhook", async () => {
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

  it("passes the LINE signature header through", async () => {
    await post(BODY, { signature: "sig-value" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ "X-Line-Signature": "sig-value", Authorization: "Bearer send-key" });
  });

  it("returns 200 without forwarding when there are no events", async () => {
    expect((await post(JSON.stringify({ destination: "U", events: [] }))).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    expect((await post("{oops")).status).toBe(400);
  });

  it("returns 200 to LINE even when the upstream fails", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 401 }));
    expect((await post(BODY)).status).toBe(200);
  });

  it("returns 200 to LINE even when the upstream is unreachable", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("network error");
    });
    expect((await post(BODY)).status).toBe(200);
  });

  it("returns 413 for a body over the limit", async () => {
    const ctx = createExecutionContext();
    const request = new Request(webhookUrl(), { method: "POST", headers: { "Content-Length": String(2 * 1024 * 1024) }, body: BODY });
    expect((await handleWebhook(request, ctx)).status).toBe(413);
  });

  it("returns 413 for a streamed body over the limit without Content-Length", async () => {
    const chunk = new Uint8Array(256 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 5) controller.enqueue(chunk);
        else controller.close();
      },
    });
    const request = new Request(webhookUrl(), { method: "POST", body: stream });
    expect(request.headers.get("Content-Length")).toBeNull();
    expect((await handleWebhook(request, createExecutionContext())).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 200 on /, 405 for non-POST and 404 for unknown paths", async () => {
    const call = (url: string) =>
      worker.fetch(new Request(url) as Request<unknown, IncomingRequestCfProperties>, {}, createExecutionContext());
    expect((await call("https://relay.example/")).status).toBe(200);
    expect((await call(webhookUrl())).status).toBe(405);
    expect((await call("https://relay.example/x")).status).toBe(404);
  });
});
