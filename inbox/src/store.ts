// D1 の読み書き。保存するのは 1対1 の message と unsend だけ。
import { toJstIso } from "./time";

export const MESSAGE_TYPES = ["text", "image", "video", "audio", "file", "sticker", "location"] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number] | "other";

interface LineSource {
  type?: string;
  userId?: string;
}

interface LineEvent {
  type?: string;
  timestamp?: number;
  webhookEventId?: string;
  deliveryContext?: { isRedelivery?: boolean };
  source?: LineSource;
  message?: Record<string, unknown>;
  unsend?: { messageId?: string };
}

export interface SaveResult {
  saved: number;
  duplicated: number;
  unsent: number;
  skipped: number;
}

export function aliasOf(contactId: number): string {
  return `c${String(contactId).padStart(4, "0")}`;
}

export function contactIdOf(alias: string): number | null {
  const match = /^c(\d{4,})$/.exec(alias);
  return match ? Number(match[1]) : null;
}

function normalizeType(type: unknown): MessageType {
  return (MESSAGE_TYPES as readonly unknown[]).includes(type) ? (type as MessageType) : "other";
}

function providerOf(message: Record<string, unknown>): string | undefined {
  const provider = message.contentProvider as { type?: unknown } | undefined;
  return typeof provider?.type === "string" ? provider.type : undefined;
}

// 種類ごとに残すメタデータ。お客さんが書いた文字は text の本文だけにする。
export function metaOf(type: MessageType, message: Record<string, unknown>): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  switch (type) {
    case "text":
      if (typeof message.quotedMessageId === "string") meta.quoted_message_id = message.quotedMessageId;
      break;
    case "image": {
      meta.content_provider = providerOf(message);
      const set = message.imageSet as { index?: unknown; total?: unknown } | undefined;
      if (typeof set?.index === "number") meta.image_set_index = set.index;
      if (typeof set?.total === "number") meta.image_set_total = set.total;
      break;
    }
    case "video":
    case "audio":
      if (typeof message.duration === "number") meta.duration = message.duration;
      meta.content_provider = providerOf(message);
      break;
    case "file":
      if (typeof message.fileSize === "number") meta.size = message.fileSize;
      break;
    case "sticker":
      if (typeof message.packageId === "string") meta.package_id = message.packageId;
      if (typeof message.stickerId === "string") meta.sticker_id = message.stickerId;
      break;
    case "location":
      break;
    case "other":
      if (typeof message.type === "string") meta.line_type = message.type;
      break;
  }
  for (const key of Object.keys(meta)) if (meta[key] === undefined) delete meta[key];
  return meta;
}

// 1回の Webhook のイベントを、まとめて1つの batch で保存する。
export async function saveEvents(db: D1Database, events: unknown[], receivedAt: number): Promise<SaveResult> {
  const result: SaveResult = { saved: 0, duplicated: 0, unsent: 0, skipped: 0 };
  const statements: D1PreparedStatement[] = [];
  const counted: { index: number; kind: "message" | "unsend" }[] = [];

  for (const raw of events) {
    const event = raw as LineEvent;
    const userId = event.source?.type === "user" ? event.source.userId : undefined;
    if (typeof userId !== "string") {
      result.skipped++;
      continue;
    }

    if (event.type === "unsend" && typeof event.unsend?.messageId === "string") {
      const messageId = event.unsend.messageId;
      // 取り消しの印を残し、あとから元のメッセージが再送されても入れない。
      statements.push(
        db.prepare("INSERT OR IGNORE INTO unsent (message_id, unsent_at) VALUES (?1, ?2)").bind(messageId, receivedAt),
      );
      counted.push({ index: statements.length, kind: "unsend" });
      statements.push(db.prepare("DELETE FROM messages WHERE message_id = ?1").bind(messageId));
      statements.push(
        db
          .prepare(
            `DELETE FROM contacts WHERE user_id = ?1
               AND NOT EXISTS (SELECT 1 FROM messages WHERE messages.contact_id = contacts.id)`,
          )
          .bind(userId),
      );
      continue;
    }

    const message = event.message;
    if (
      event.type !== "message" ||
      message === undefined ||
      typeof message.id !== "string" ||
      typeof event.webhookEventId !== "string" ||
      typeof event.timestamp !== "number"
    ) {
      result.skipped++;
      continue;
    }

    const type = normalizeType(message.type);
    const text = type === "text" && typeof message.text === "string" ? message.text : null;
    // 取り消し済みのメッセージなら、別名も作らない。ON CONFLICT の upsert は AUTOINCREMENT の番号を空費するので、無いときだけ入れる。
    statements.push(
      db
        .prepare(
          `INSERT INTO contacts (user_id, first_seen_at, last_seen_at)
           SELECT ?1, ?2, ?2
            WHERE NOT EXISTS (SELECT 1 FROM contacts WHERE user_id = ?1)
              AND NOT EXISTS (SELECT 1 FROM unsent WHERE message_id = ?3)`,
        )
        .bind(userId, receivedAt, message.id),
      db.prepare("UPDATE contacts SET last_seen_at = ?2 WHERE user_id = ?1").bind(userId, receivedAt),
    );
    counted.push({ index: statements.length, kind: "message" });
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO messages
             (webhook_event_id, message_id, contact_id, type, text, meta, sent_at, received_at, is_redelivery)
           SELECT ?3, ?4, id, ?5, ?6, ?7, ?8, ?2, ?9 FROM contacts
            WHERE user_id = ?1 AND NOT EXISTS (SELECT 1 FROM unsent WHERE message_id = ?4)`,
        )
        .bind(
          userId,
          receivedAt,
          event.webhookEventId,
          message.id,
          type,
          text,
          JSON.stringify(metaOf(type, message)),
          event.timestamp,
          event.deliveryContext?.isRedelivery ? 1 : 0,
        ),
    );
  }

  if (statements.length === 0) return result;
  const results = await db.batch(statements);
  for (const { index, kind } of counted) {
    const changes = results[index]?.meta.changes ?? 0;
    if (kind === "unsend") result.unsent += changes;
    else if (changes > 0) result.saved++;
    else result.duplicated++;
  }
  return result;
}

export interface MessageRow {
  seq: number;
  message_id: string;
  contact_id: number;
  type: MessageType;
  text: string | null;
  meta: string;
  sent_at: number;
  received_at: number;
  seen_at: number | null;
}

export function toMessageView(row: MessageRow) {
  return {
    id: row.message_id,
    alias: aliasOf(row.contact_id),
    type: row.type,
    text: row.text,
    meta: JSON.parse(row.meta) as Record<string, unknown>,
    sent_at: toJstIso(row.sent_at),
    received_at: toJstIso(row.received_at),
    seen: row.seen_at !== null,
  };
}
