// 定時の削除。RETENTION_DAYS より古い行と、行のなくなった別名を消す。
import { type Env, retentionDays } from "./env";

export const CLEANUP_BATCH = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// 一度に消す件数を区切り、上限の回数までくり返す。
export const CLEANUP_MAX_ROUNDS = 50;

export async function cleanup(env: Env, now = Date.now()): Promise<number | null> {
  const days = retentionDays(env);
  if (days === null) {
    console.log("cleanup: 保持日数の設定がないので消さない");
    return null;
  }
  const cutoff = now - days * DAY_MS;
  let total = 0;
  for (let round = 0; round < CLEANUP_MAX_ROUNDS; round++) {
    const deleted = await env.DB.prepare(
      "DELETE FROM messages WHERE rowid IN (SELECT rowid FROM messages WHERE received_at < ?1 LIMIT ?2)",
    )
      .bind(cutoff, CLEANUP_BATCH)
      .run();
    total += deleted.meta.changes;
    if (deleted.meta.changes < CLEANUP_BATCH) break;
  }
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM contacts WHERE NOT EXISTS (SELECT 1 FROM messages WHERE messages.contact_id = contacts.id)",
    ),
    env.DB.prepare("DELETE FROM unsent WHERE unsent_at < ?1").bind(cutoff),
  ]);
  console.log("cleanup: 削除", { messages: total });
  return total;
}
