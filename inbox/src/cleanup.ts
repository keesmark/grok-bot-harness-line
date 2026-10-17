// 定時の削除。RETENTION_DAYS より古い行と、行のなくなった別名を消す。
import { type Env, retentionDays } from "./env";

export const CLEANUP_BATCH = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function cleanup(env: Env, now = Date.now()): Promise<number | null> {
  const days = retentionDays(env);
  if (days === null) {
    console.log("cleanup: 保持日数の設定がないので消さない");
    return null;
  }
  const [deleted] = await env.DB.batch([
    env.DB
      .prepare("DELETE FROM messages WHERE rowid IN (SELECT rowid FROM messages WHERE received_at < ?1 LIMIT ?2)")
      .bind(now - days * DAY_MS, CLEANUP_BATCH),
    env.DB.prepare(
      "DELETE FROM contacts WHERE NOT EXISTS (SELECT 1 FROM messages WHERE messages.contact_id = contacts.id)",
    ),
  ]);
  console.log("cleanup: 削除", { messages: deleted.meta.changes });
  return deleted.meta.changes;
}
