-- お客さん1人に1行。id から別名（c0012 など）を作る
CREATE TABLE contacts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT, -- 消しても番号を使い回さない
  user_id       TEXT    NOT NULL UNIQUE,           -- LINE の userId
  first_seen_at INTEGER NOT NULL,                  -- 最初に受けた時刻（UNIXミリ秒）
  last_seen_at  INTEGER NOT NULL                   -- 最後に受けた時刻（UNIXミリ秒）
);

-- 届いたメッセージ1件に1行
CREATE TABLE messages (
  webhook_event_id TEXT    PRIMARY KEY,            -- 重複排除のかぎ
  message_id       TEXT    NOT NULL UNIQUE,        -- LINE の message.id。道具の id に使う
  contact_id       INTEGER NOT NULL REFERENCES contacts(id),
  type             TEXT    NOT NULL
                   CHECK (type IN ('text','image','video','audio','file','sticker','location','other')),
  text             TEXT,                           -- type が text のときだけ入る
  meta             TEXT    NOT NULL DEFAULT '{}',  -- 種類ごとのメタデータ（JSON）
  sent_at          INTEGER NOT NULL,               -- LINE の timestamp（UNIXミリ秒）
  received_at      INTEGER NOT NULL,               -- 中継が受けた時刻（UNIXミリ秒）
  is_redelivery    INTEGER NOT NULL DEFAULT 0,     -- LINE の再送なら 1
  seen_at          INTEGER,                        -- mark_seen の時刻。NULL なら未読
  CHECK (type = 'text' OR text IS NULL)
);

-- 送信取消された message.id。あとから元のメッセージが再送されても入れないための印
CREATE TABLE unsent (
  message_id TEXT    PRIMARY KEY,
  unsent_at  INTEGER NOT NULL                      -- 取消を受けた時刻（UNIXミリ秒）
);

CREATE INDEX messages_by_received ON messages (received_at);
CREATE INDEX messages_by_contact  ON messages (contact_id, received_at);
CREATE INDEX messages_unseen      ON messages (received_at) WHERE seen_at IS NULL;
