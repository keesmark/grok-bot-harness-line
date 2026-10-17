# grok-bot-harness-line

[English](README.en.md) | 日本語

LINE 公式アカウントの Webhook を、Grok Bot の Webhook に届けるための Cloudflare Workers のテンプレートです。
LINE の Webhook は送信キーのヘッダーを付けられないので、この Worker が間に立ってキーを付け替えます。
あなた自身の Cloudflare アカウント（無料プラン）で動きます。作者のサーバーは一切通りません。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/keesmark/grok-bot-harness-line)

- 何も保存しません。届いた本文を、そのまま Grok Bot に流すだけです。
- LINE へ送信する機能はありません。チャネルアクセストークンも持ちません。
- デプロイ画面で入れるのは、この Worker 専用の合言葉 `RELAY_KEY` の1つだけです。

## 準備するもの

- Messaging API が使える LINE 公式アカウント（[LINE Developers コンソール](https://developers.line.biz/console/)）
- Grok Bot の Webhook の URL と送信キー
- 合言葉にする長いランダムな文字列（例: `openssl rand -hex 32` の出力）
- Cloudflare のアカウント（無料プランで動きます）
- GitHub のアカウント（ボタンを押すと、このリポジトリがあなたの GitHub に複製されます）

## つなぎ方

デプロイ画面で `RELAY_KEY` に合言葉を入れてデプロイします。できたら、LINE Developers コンソールの Webhook URL に次を貼り、「検証」を押して成功を確かめます。

```
https://<Worker の URL>/webhook?url=<Grok Bot の Webhook の URL>&token=<送信キー>&key=<合言葉>
```

`url` は URL エンコードしてください。Worker は `token` を `Authorization: Bearer <送信キー>` に付け替えて、本文を LINE から届いたまま `url` に流します。

- Grok Bot の Webhook の URL は `https://api2.cursor.sh/automations/webhook/…` の形です。
- 流せる宛先は、`cursor.sh` とそのサブドメインの https の URL だけです（`src/env.ts` の `GROK_BOT_DOMAINS`）。パスは問わないので、Grok Bot の URL の形が変わっても動き続けます。ほかの宛先を指定すると 403 になり、どこにも流しません。
- 送信キーと合言葉が URL に入るので、リクエストのログは残しません。この URL はチャットなどに貼らないでください。
- 「検証」ボタンのようにイベントが空のものは流しません。
- 流した先がエラーを返しても、LINE には 200 を返します。LINE は再送しないので、そのメッセージは LINE のチャットで確かめてください。

### LINE の署名について

この Worker は LINE の署名を確かめません。偽のメッセージを Grok Bot に届けるには送信キー（`token`）が要りますが、送信キーを知っている人は Worker を通さずに Grok Bot へ直接送れるので、Worker で確かめても守りが増えないためです。LINE の `X-Line-Signature` ヘッダーはそのまま Grok Bot に渡すので、必要なら Grok Bot 側で確かめられます。

### 合言葉（RELAY_KEY）について

合言葉がないと、Worker の URL を知った人が、自分の `token` と本文を付けて、あなたの Worker から `cursor.sh` に POST させられます（踏み台）。これを防ぐため、`key` が `RELAY_KEY` と合わないリクエストは 401 にして、どこにも流しません。`RELAY_KEY` が設定されていないときは 500 を返し、何も流しません。

合言葉をあとから変えるときは、次のコマンドか、Cloudflare のダッシュボードで Worker の「設定」→「変数とシークレット」から変え、LINE に登録した URL の `key=` も合わせて変えます。

```sh
npx wrangler secret put RELAY_KEY
```

## 設計

### 全体の流れ

```mermaid
sequenceDiagram
    participant U as LINE ユーザー
    participant L as LINE Platform
    participant W as Worker（あなたの Cloudflare）
    participant G as Grok Bot

    U->>L: メッセージを送る
    L->>W: POST /webhook?url=…&token=…&key=…<br/>X-Line-Signature 付き
    W->>W: 合言葉・宛先・本文を確かめる
    W-->>L: 200（すぐ返す）
    W->>G: POST url<br/>Authorization: Bearer token<br/>X-Line-Signature はそのまま<br/>本文は届いたまま
    G-->>W: 応答（ログには件数と状態だけ残す）
```

LINE には先に 200 を返し、Grok Bot への転送はその後ろで行います（`ctx.waitUntil`）。Worker は何も保存しません。

### リクエストの判定

```mermaid
flowchart TD
    A[リクエスト] --> B{パス}
    B -- / --> OK[200 ok]
    B -- その他 --> N404[404]
    B -- /webhook --> C{POST か}
    C -- いいえ --> N405[405]
    C -- はい --> S{RELAY_KEY が<br/>設定されているか}
    S -- いいえ --> N500[500]
    S -- はい --> K{key が RELAY_KEY と合うか}
    K -- いいえ --> N401[401]
    K -- はい --> D{url と token があり<br/>url が読めるか}
    D -- いいえ --> N400a[400]
    D -- はい --> E{宛先が cursor.sh か<br/>https・ポートなし・ユーザー情報なし<br/>cursor.sh かそのサブドメイン}
    E -- いいえ --> N403[403]
    E -- はい --> F{本文が 1MiB 以下か}
    F -- いいえ --> N413[413]
    F -- はい --> G{JSON として読めるか}
    G -- いいえ --> N400b[400]
    G -- はい --> H{events が空か}
    H -- 空 --> R200a[200・転送しない]
    H -- ある --> R200b[200・Grok Bot へ転送]
```

### ファイル

| ファイル | 役目 |
| --- | --- |
| `src/index.ts` | パスごとの振り分け |
| `src/webhook.ts` | `/webhook` の処理と Grok Bot への転送 |
| `src/env.ts` | 転送してよい宛先の一覧と、`url`・`token` からの宛先づくり |
| `src/key.ts` | `RELAY_KEY` と `key` の照合 |
| `src/body.ts` | 本文を上限つきで読む |

## セキュリティ

- 実行時の依存はありません。開発用の道具は版を固定し、ロックファイルを入れています。
- 本文の大きさに上限（1MiB）をかけ、上限を超えたら読むのをやめます。
- ログには本文・URL・鍵を出しません。

## 開発

```sh
npm ci
cp .dev.vars.example .dev.vars  # RELAY_KEY= に好きな値を入れる
npm test
npm run coverage
npm run dev
```

---

LINE は LINE ヤフー株式会社の商標です。本リポジトリは LINE ヤフー株式会社の公式製品ではありません。
