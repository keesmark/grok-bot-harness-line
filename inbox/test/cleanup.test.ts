import { beforeEach, describe, expect, it } from "vitest";
import { cleanup } from "../src/cleanup";
import { payload, postWebhook, resetDb, testEnv, textEvent, tool } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

describe("定時の削除", () => {
  beforeEach(resetDb);

  it("古い行と、行のなくなった別名を消し、新しい行は残す", async () => {
    await postWebhook(payload([textEvent("OLD", "古い")]));
    await postWebhook(payload([textEvent("NEW", "新しい")]));
    await testEnv.DB.prepare(
      "UPDATE messages SET received_at = received_at - ?1 WHERE contact_id = (SELECT id FROM contacts WHERE user_id = 'OLD')",
    )
      .bind(31 * DAY)
      .run();

    expect(await cleanup({ ...testEnv, RETENTION_DAYS: "30" })).toBe(1);
    const { results } = await testEnv.DB.prepare("SELECT user_id FROM contacts").all<any>();
    expect(results.map((r: any) => r.user_id)).toEqual(["NEW"]);
  });

  it("RETENTION_DAYS が空か不正なら何も消さず、retention_days が null", async () => {
    await postWebhook(payload([textEvent("OLD", "古い")]));
    await testEnv.DB.prepare("UPDATE messages SET received_at = 0").run();
    for (const value of ["", "0", "-1", "1.5", "abc"]) {
      expect(await cleanup({ ...testEnv, RETENTION_DAYS: value })).toBeNull();
    }
    const { results } = await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM messages").all<any>();
    expect(results[0].n).toBe(1);
  });

  it("一度に消す件数を超えても、期限切れの行をすべて消す", async () => {
    await postWebhook(payload([textEvent("OLD", "古い")]));
    await testEnv.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2500)
       INSERT INTO messages (webhook_event_id, message_id, contact_id, type, text, sent_at, received_at)
       SELECT 'BULK' || i, 'BULKM' || i, (SELECT id FROM contacts), 'text', 'x', 0, 0 FROM n`,
    ).run();
    expect(await cleanup({ ...testEnv, RETENTION_DAYS: "1" }, 10 * DAY)).toBe(2500);
  });

  it("消した別名の番号は使い回さない", async () => {
    await postWebhook(payload([textEvent("A", "a")]));
    await testEnv.DB.prepare("UPDATE messages SET received_at = 0").run();
    await cleanup({ ...testEnv, RETENTION_DAYS: "30" });
    await postWebhook(payload([textEvent("B", "b")]));
    const { data } = await tool("list_new_messages");
    expect(data.messages[0].alias).toBe("c0002");
  });
});
