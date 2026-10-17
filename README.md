# grok-bot-harness-line

English | [日本語](README.ja.md)

A Cloudflare Workers template that delivers webhooks from a LINE Official Account to a Grok Bot webhook.
LINE webhooks cannot carry a custom key header, so this Worker sits in between and moves the key into one.
It runs on your own Cloudflare account (the free plan is enough). Nothing passes through the author's servers.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/keesmark/grok-bot-harness-line)

- It stores nothing. It passes the request body to Grok Bot as received.
- It cannot send messages to LINE and holds no channel access token.
- There are no values to fill in on the deploy screen.

## What you need

- A LINE Official Account with the Messaging API enabled ([LINE Developers Console](https://developers.line.biz/console/))
- Your Grok Bot webhook URL and key
- A Cloudflare account (the free plan is enough)
- A GitHub account (the button copies this repository into your GitHub)

## Connecting LINE

After deploying, paste the following into the Webhook URL field in the LINE Developers Console, then press "Verify" and check that it succeeds.

```
https://<your Worker URL>/webhook?url=<Grok Bot webhook URL>&token=<key>
```

URL-encode `url`. The Worker sends `token` as `Authorization: Bearer <key>` and posts the body to `url` exactly as LINE sent it.

- A Grok Bot webhook URL looks like `https://api2.cursor.sh/automations/webhook/…`.
- Only URLs of that form are allowed as destinations (`GROK_BOT_TARGETS` in `src/env.ts`). Any other destination gets a 403 and nothing is forwarded.
- The key is part of the URL, so request logs are turned off. Do not paste this URL into chats or other places.
- Requests with no events, such as the "Verify" button, are not forwarded.
- The Worker returns 200 to LINE even when the destination returns an error. LINE does not retry, so check that message in the LINE chat.

### About the LINE signature

This Worker does not verify the LINE signature. Sending a fake message to Grok Bot through the Worker requires the key (`token`), and anyone with the key can call Grok Bot directly without the Worker, so verifying here adds no protection. The `X-Line-Signature` header is passed through to Grok Bot unchanged, so Grok Bot can verify it if needed.

## Security

- No runtime dependencies. Development tools are pinned to exact versions with a lockfile.
- The request body is capped at 1 MiB, and reading stops once the cap is exceeded.
- Logs never include the body, the URL, or the key.

## Development

```sh
npm ci
npm test
npm run dev
```

---

LINE is a trademark of LY Corporation. This repository is not an official product of LY Corporation.
