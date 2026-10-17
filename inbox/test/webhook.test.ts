import { beforeEach, describe, expect, it } from "vitest";
import { call, messageEvent, payload, postWebhook, resetDb, sign, testEnv, textEvent } from "./helpers";

async function rows() {
  const { results } = await testEnv.DB.prepare("SELECT * FROM messages ORDER BY received_at, rowid").all<any>();
  return results;
}

describe("/webhook", () => {
  beforeEach(resetDb);

  it("正しい署名なら200を返し、保存する", async () => {
    const response = await postWebhook(payload([textEvent("U1", "明日の午後、予約できますか？🙂")]));
    expect(response.status).toBe(200);
    const saved = await rows();
    expect(saved).toHaveLength(1);
    expect(saved[0].text).toBe("明日の午後、予約できますか？🙂");
  });

  it("署名がない・44文字でない・base64でないときは401", async () => {
    const body = payload([textEvent("U1", "x")]);
    const missing = await call(new Request("https://relay.example/webhook", { method: "POST", body }));
    expect(missing.status).toBe(401);
    expect((await postWebhook(body, "a".repeat(43))).status).toBe(401);
    expect((await postWebhook(body, "a".repeat(45))).status).toBe(401);
    expect((await postWebhook(body, "!".repeat(44))).status).toBe(401);
    expect(await rows()).toHaveLength(0);
  });

  it("1バイト違いの署名は401で、保存しない", async () => {
    const body = payload([textEvent("U1", "x")]);
    const good = await sign(body);
    const bad = (good[0] === "A" ? "B" : "A") + good.slice(1);
    expect((await postWebhook(body, bad)).status).toBe(401);
    expect(await rows()).toHaveLength(0);
  });

  it("違うシークレットの署名は401", async () => {
    const body = payload([textEvent("U1", "x")]);
    expect((await postWebhook(body, await sign(body, "other-secret"))).status).toBe(401);
  });

  it("Content-Length が上限を超えると413", async () => {
    const body = payload([]);
    const response = await call(
      new Request("https://relay.example/webhook", {
        method: "POST",
        headers: { "X-Line-Signature": await sign(body), "Content-Length": String(2 * 1024 * 1024) },
        body,
      }),
    );
    expect(response.status).toBe(413);
  });

  it("Content-Length がなくても、上限を超えたら413", async () => {
    const big = new Uint8Array(1024 * 1024 + 1);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(big);
        controller.close();
      },
    });
    const response = await call(
      new Request("https://relay.example/webhook", {
        method: "POST",
        headers: { "X-Line-Signature": "a".repeat(43) + "=" },
        body: stream,
        // @ts-expect-error Workers の Request はストリーム本文に duplex を求めない
        duplex: "half",
      }),
    );
    expect(response.status).toBe(413);
  });

  it("署名は正しいがJSONが壊れていると400", async () => {
    const body = "{not json";
    expect((await postWebhook(body)).status).toBe(400);
  });

  it("CHANNEL_SECRET がなければ503", async () => {
    expect((await postWebhook(payload([]), "a".repeat(44), { CHANNEL_SECRET: "" })).status).toBe(503);
  });

  it("POST 以外は405", async () => {
    expect((await call(new Request("https://relay.example/webhook"))).status).toBe(405);
  });

  it("events が空でも200で、何も入らない", async () => {
    expect((await postWebhook(payload([]))).status).toBe(200);
    expect(await rows()).toHaveLength(0);
  });

  it("同じ webhookEventId は1行だけ", async () => {
    const event = textEvent("U1", "x");
    await postWebhook(payload([event]));
    await postWebhook(payload([{ ...event, deliveryContext: { isRedelivery: true } }]));
    expect(await rows()).toHaveLength(1);
  });

  it("グループ・複数人トークは保存しない", async () => {
    const group = { ...textEvent("U1", "x"), source: { type: "group", groupId: "G1", userId: "U1" } };
    const room = { ...textEvent("U1", "y"), source: { type: "room", roomId: "R1", userId: "U1" } };
    await postWebhook(payload([group, room]));
    expect(await rows()).toHaveLength(0);
  });

  it("follow などのイベントは保存しない", async () => {
    await postWebhook(payload([{ type: "follow", timestamp: 1, webhookEventId: "F1", source: { type: "user", userId: "U1" } }]));
    expect(await rows()).toHaveLength(0);
  });

  it("unsend でその行が消える", async () => {
    const event = textEvent("U1", "取り消す文");
    await postWebhook(payload([event]));
    await postWebhook(
      payload([{ type: "unsend", timestamp: 2, webhookEventId: "U-1", source: { type: "user", userId: "U1" }, unsend: { messageId: event.message.id } }]),
    );
    expect(await rows()).toHaveLength(0);
  });

  it("種類ごとに決めたメタデータだけを残し、text 以外に本文を入れない", async () => {
    await postWebhook(
      payload([
        messageEvent("U1", { type: "image", contentProvider: { type: "line" }, imageSet: { id: "S", index: 1, total: 2 } }),
        messageEvent("U1", { type: "video", duration: 6000, contentProvider: { type: "external", originalContentUrl: "https://x" } }),
        messageEvent("U1", { type: "audio", duration: 3000, contentProvider: { type: "line" } }),
        messageEvent("U1", { type: "file", fileName: "見積書.pdf", fileSize: 1234 }),
        messageEvent("U1", { type: "sticker", packageId: "1", stickerId: "2", keywords: ["hi"], text: "x" }),
        messageEvent("U1", { type: "location", title: "家", address: "東京都", latitude: 35, longitude: 139 }),
        messageEvent("U1", { type: "brand-new", text: "未知の種類" }),
      ]),
    );
    const saved = await rows();
    expect(saved.map((r: any) => [r.type, r.text, JSON.parse(r.meta)])).toEqual([
      ["image", null, { content_provider: "line", image_set_index: 1, image_set_total: 2 }],
      ["video", null, { duration: 6000, content_provider: "external" }],
      ["audio", null, { duration: 3000, content_provider: "line" }],
      ["file", null, { size: 1234 }],
      ["sticker", null, { package_id: "1", sticker_id: "2" }],
      ["location", null, {}],
      ["other", null, { line_type: "brand-new" }],
    ]);
    expect(JSON.stringify(saved)).not.toContain("見積書");
    expect(JSON.stringify(saved)).not.toContain("東京都");
  });

  it("/ は ok だけを返し、知らないパスは404", async () => {
    const root = await call(new Request("https://relay.example/"));
    expect(await root.text()).toContain("ok");
    expect((await call(new Request("https://relay.example/nope"))).status).toBe(404);
  });
});
