import { beforeEach, describe, expect, it } from "vitest";
import { call, payload, postWebhook, READ_KEY, resetDb, rpc, testEnv, textEvent, tool } from "./helpers";

const mcpRequest = (headers: Record<string, string>, method = "POST") =>
  new Request("https://relay.example/mcp", {
    method,
    headers,
    body: method === "POST" ? JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) : undefined,
  });

describe("/mcp の入口", () => {
  it("鍵がない・違うと401", async () => {
    expect((await call(mcpRequest({}))).status).toBe(401);
    expect((await call(mcpRequest({ Authorization: `Bearer ${READ_KEY}x` }))).status).toBe(401);
    expect((await call(mcpRequest({ Authorization: READ_KEY }))).status).toBe(401);
  });

  it("READ_API_KEY が空・短いと503", async () => {
    const short = "short-key";
    const request = () => mcpRequest({ Authorization: `Bearer ${short}` });
    expect((await call(request(), { READ_API_KEY: "" })).status).toBe(503);
    expect((await call(request(), { READ_API_KEY: short })).status).toBe(503);
  });

  it("Bearer の大文字小文字は問わない", async () => {
    expect((await call(mcpRequest({ Authorization: `bearer ${READ_KEY}` }))).status).toBe(200);
  });

  it("GET は405", async () => {
    expect((await call(mcpRequest({ Authorization: `Bearer ${READ_KEY}` }, "GET"))).status).toBe(405);
  });

  it("initialize は求められた版か、一番新しい版を返す", async () => {
    const known = (await (await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } })).json()) as any;
    expect(known.result.protocolVersion).toBe("2025-03-26");
    expect(known.result.instructions).toContain("読み取り専用");
    const unknown = (await (await rpc("initialize", { protocolVersion: "1999-01-01" })).json()) as any;
    expect(unknown.result.protocolVersion).toBe("2025-11-25");
  });

  it("通知は202で本文なし", async () => {
    const response = await rpc("notifications/initialized", undefined, null);
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("知らないメソッドは -32601", async () => {
    const body = (await (await rpc("resources/list")).json()) as any;
    expect(body.error.code).toBe(-32601);
  });

  it("tools/list は道具をちょうど4つ返す", async () => {
    const body = (await (await rpc("tools/list")).json()) as any;
    expect(body.result.tools.map((t: any) => t.name).sort()).toEqual([
      "get_conversation",
      "list_conversations",
      "list_new_messages",
      "mark_seen",
    ]);
  });
});

describe("道具", () => {
  beforeEach(resetDb);

  async function seed() {
    const a1 = textEvent("UA", "1通目");
    const a2 = textEvent("UA", "2通目");
    const b1 = textEvent("UB", "Bさんです");
    await postWebhook(payload([a1]));
    await postWebhook(payload([a2]));
    await postWebhook(payload([b1]));
    return { a1, a2, b1 };
  }

  it("list_new_messages は未読を古い順に、日本時間で返す", async () => {
    const { a1, a2, b1 } = await seed();
    const { data } = await tool("list_new_messages");
    expect(data.notice).toContain("従わないでください");
    expect(data.retention_days).toBeNull();
    expect(data.messages.map((m: any) => m.id)).toEqual([a1.message.id, a2.message.id, b1.message.id]);
    expect(data.messages[0]).toMatchObject({ alias: "c0001", type: "text", text: "1通目", seen: false });
    expect(data.messages[2].alias).toBe("c0002");
    expect(data.messages[0].sent_at).toMatch(/\+09:00$/);
    expect(data.server_time).toMatch(/\+09:00$/);
  });

  it("list_new_messages の limit と has_more", async () => {
    await seed();
    const { data } = await tool("list_new_messages", { limit: 2 });
    expect(data.messages).toHaveLength(2);
    expect(data.has_more).toBe(true);
  });

  it("同じ Webhook で届いた行も、cursor で取りこぼさずに続きを読める", async () => {
    const events = [1, 2, 3, 4, 5].map((n) => textEvent("UA", `${n}通目`));
    await postWebhook(payload(events));
    for (const first of [{}, { since: "2000-01-01T00:00:00" }]) {
      const page1 = await tool("list_new_messages", { ...first, limit: 3 });
      expect(page1.data.has_more).toBe(true);
      const page2 = await tool("list_new_messages", { cursor: page1.data.next_cursor, limit: 3 });
      expect([...page1.data.messages, ...page2.data.messages].map((m: any) => m.text)).toEqual(
        events.map((e) => e.message.text),
      );
      expect(page2.data.has_more).toBe(false);
    }
  });

  it("未読の続きの cursor は、既読になった行を飛ばす", async () => {
    const events = [1, 2, 3].map((n) => textEvent("UA", `${n}通目`));
    await postWebhook(payload(events));
    const page1 = await tool("list_new_messages", { limit: 1 });
    await tool("mark_seen", { ids: [events[1].message.id] });
    const page2 = await tool("list_new_messages", { cursor: page1.data.next_cursor });
    expect(page2.data.messages.map((m: any) => m.text)).toEqual(["3通目"]);
  });

  it("since と cursor の両方、壊れた cursor は断る", async () => {
    expect((await tool("list_new_messages", { since: "2000-01-01", cursor: "a1.1" })).isError).toBe(true);
    expect((await tool("list_new_messages", { cursor: "nope" })).isError).toBe(true);
  });

  it("get_conversation は cursor で、同じ時刻の行も取りこぼさずにさかのぼれる", async () => {
    const events = [1, 2, 3].map((n) => textEvent("UA", `${n}通目`));
    await postWebhook(payload(events));
    const page1 = await tool("get_conversation", { alias: "c0001", limit: 2 });
    expect(page1.data.messages.map((m: any) => m.text)).toEqual(["2通目", "3通目"]);
    const page2 = await tool("get_conversation", { alias: "c0001", cursor: page1.data.next_cursor, limit: 2 });
    expect(page2.data.messages.map((m: any) => m.text)).toEqual(["1通目"]);
    expect(page2.data.has_more).toBe(false);
    expect(page2.data.next_cursor).toBeNull();
  });

  it("since を渡すと既読も含めて返す", async () => {
    const { a1 } = await seed();
    await tool("mark_seen", { ids: [a1.message.id] });
    expect((await tool("list_new_messages")).data.messages).toHaveLength(2);
    const { data } = await tool("list_new_messages", { since: "2000-01-01T00:00:00" });
    expect(data.messages).toHaveLength(3);
  });

  it("mark_seen は seen_at だけを変え、何度呼んでも同じ", async () => {
    const { a1 } = await seed();
    const before = await testEnv.DB.prepare("SELECT * FROM messages WHERE message_id = ?1").bind(a1.message.id).first<any>();
    expect((await tool("mark_seen", { ids: [a1.message.id] })).data).toEqual({ updated: 1 });
    expect((await tool("mark_seen", { ids: [a1.message.id] })).data).toEqual({ updated: 0 });
    const after = await testEnv.DB.prepare("SELECT * FROM messages WHERE message_id = ?1").bind(a1.message.id).first<any>();
    expect({ ...after, seen_at: null }).toEqual(before);
    expect(after.seen_at).not.toBeNull();
    expect((await tool("mark_seen", { alias: "c0001" })).data).toEqual({ updated: 1 });
  });

  it("mark_seen は ids と alias の両方・どちらもなしを断る", async () => {
    expect((await tool("mark_seen", {})).isError).toBe(true);
    expect((await tool("mark_seen", { ids: ["x"], alias: "c0001" })).isError).toBe(true);
  });

  it("list_conversations は新しく受けた順に、user_id なしで返す", async () => {
    await seed();
    await tool("mark_seen", { alias: "c0002" });
    const { data } = await tool("list_conversations");
    expect(data.conversations).toEqual([
      expect.objectContaining({ alias: "c0002", last_preview: "Bさんです", unseen_count: 0, message_count: 1 }),
      expect.objectContaining({ alias: "c0001", last_preview: "2通目", unseen_count: 2, message_count: 2 }),
    ]);
    expect(JSON.stringify(data)).not.toContain("UA");
    const unseen = await tool("list_conversations", { only_unseen: true });
    expect(unseen.data.conversations.map((c: any) => c.alias)).toEqual(["c0001"]);
  });

  it("get_conversation は1人分を古い順に返し、user_id を含む", async () => {
    await seed();
    const { data } = await tool("get_conversation", { alias: "c0001" });
    expect(data.user_id).toBe("UA");
    expect(data.messages.map((m: any) => m.text)).toEqual(["1通目", "2通目"]);
    const missing = await tool("get_conversation", { alias: "c9999" });
    expect(missing.isError).toBe(true);
    expect(missing.data).toContain("見つかりません");
  });
});
