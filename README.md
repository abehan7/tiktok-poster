# TikTok Poster

Personal Electron app for posting **videos** and **photo carousels** to TikTok
through the official Content Posting API.

```bash
npm install
npm run dev      # hot-reloading app
npm run dist     # build dist/mac-arm64/TikTok Poster.app
```

With no TikTok client key set, the app runs in **mock mode**: login, upload
progress and status polling all work against a fake TikTok, so you can try it
right away.

## One-time setup

### 1. TikTok developer app

1. Go to <https://developers.tiktok.com/apps> and create an app.
2. Add **Login Kit**. Under **Desktop**, register the redirect URI shown in
   Settings. The default is `http://127.0.0.1:53682/callback/`, and it must match exactly.
3. Add the **Content Posting API**. Turn on **Direct Post** if you want to post
   straight to your profile. Upload (drafts) works without it.
4. Scopes: `user.info.basic`, `video.upload`, plus `video.publish` for direct posts.
5. To post carousels, verify your R2 custom domain (or a URL prefix on it)
   under **URL properties**.
6. Paste the client key and secret into **Settings**, then click **Connect TikTok**.

Until TikTok audits the app, direct posts are forced to private (`SELF_ONLY`).
**Draft to inbox** avoids that: the post lands in your TikTok app's inbox and
you publish it from your phone.

### 2. Cloudflare R2 (carousels only)

TikTok only accepts photos by pulling them from a public HTTPS URL on a
verified domain, with no redirects. Videos are uploaded directly and don't need this.

1. Create a bucket and connect a **custom domain** to it, e.g. `media.example.com`.
2. Create an R2 API token with Object Read & Write on that bucket.
3. In Settings, fill in the account ID, the key ID and secret, the bucket, and the public base URL
   (`https://media.example.com`). Then click **Save & test R2**.

Images are converted to JPEG (at most 1080p, under 20 MB) and uploaded to
`<prefix>/<timestamp>-<id>/<n>.jpg` before TikTok is asked to pull them.

## How it works

| Piece | Where |
| --- | --- |
| OAuth: desktop Login Kit, PKCE with a hex SHA-256 challenge, one-shot loopback server | `src/main/tiktok/oauth.ts` |
| TikTok API (live and mock) | `src/main/tiktok/*Gateway.ts` |
| Token storage and refresh | `src/main/tiktok/TikTokSession.ts` |
| Video chunking, image conversion, R2 hosting, status polling | `src/main/posting/PostingService.ts` |
| R2 upload (S3 API through `aws4fetch`) | `src/main/storage/ImageHost.ts` |
| IPC contract shared by main and renderer | `src/shared/contract.ts` |
| UI (React and Tailwind v4) | `src/renderer/src` |

Settings, tokens and history are stored in `~/Library/Application Support/TikTok Poster/`.
Secrets and tokens are encrypted with Electron `safeStorage`, which is keychain-backed.

**Loading a carousel folder:** in the Carousel tab, **Load render folder…** reads a
`tubelingo-carousel/out/<id>` folder. Numbered images become the slides,
`_`-prefixed debug sheets are skipped, and `caption.txt` fills the description.
