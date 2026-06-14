# GitHub App — Local Testing Guide

This guide walks you through testing the Prisom GitHub App integration on a
local development machine. GitHub needs a **publicly reachable URL** to deliver
webhooks, so you'll set up a tunnel.

---

## Required environment variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Your tunnel or production URL (no trailing slash). The webhook URL is derived from this value. |
| `GITHUB_APP_ID` | Numeric App ID shown on the GitHub App's **About** page. |
| `GITHUB_APP_PRIVATE_KEY` | PEM private key — paste the entire key as a single string with **literal `\n` characters** (see [Private key format](#private-key-format)). |
| `GITHUB_WEBHOOK_SECRET` | Secret you set in GitHub App → Webhook Secret. Any random string ≥ 32 chars. |
| `GITHUB_CLIENT_ID` | Client ID from the GitHub App About page. |
| `GITHUB_CLIENT_SECRET` | Client secret generated on the App's About page. |
| `GITHUB_WEBHOOK_DEV_BYPASS` | *(Optional, dev only)* Set to `true` to skip signature verification during local testing **without** a tunnel. **Never set in production.** |

---

## Step 1 — Start a tunnel

Webhooks must reach your local server over HTTPS. Use either:

```bash
# ngrok (https://ngrok.com)
ngrok http 3000

# Cloudflare Tunnel (https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/run-tunnel/trycloudflare/)
cloudflared tunnel --url http://localhost:3000
```

Note the HTTPS URL the tunnel provides, e.g. `https://abc123.ngrok-free.app`.

---

## Step 2 — Set NEXT_PUBLIC_APP_URL

Add it to your `.env` (or `.env.local`):

```env
NEXT_PUBLIC_APP_URL=https://abc123.ngrok-free.app
```

The webhook URL is automatically computed as:

```
https://abc123.ngrok-free.app/api/webhooks/github
```

You can see and copy it on the **Integrations → GitHub** page.

---

## Step 3 — Create or update your GitHub App

1. Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App** (or edit an existing one).
2. Set **Homepage URL** to your `NEXT_PUBLIC_APP_URL`.
3. Enable **Active** under Webhook.
4. Set **Webhook URL** to `https://<your-tunnel>/api/webhooks/github`.
5. Set **Webhook Secret** to a random string and save the same value as `GITHUB_WEBHOOK_SECRET` in `.env`.

### Required repository permissions

| Permission | Access |
|---|---|
| Contents | Read-only |
| Metadata | Read-only (automatically selected) |

### Subscribed events

Subscribe to these events under **Permissions & events → Subscribe to events**:

- `push`
- `repository`
- `installation`
- `installation_repositories`

---

## Step 4 — Install the app and test

1. Go to **App settings → Install App** and install it on your account or organization, selecting the repositories you want to track.
2. After install, go to **App settings → Advanced → Recent Deliveries** and click **Send ping** to verify the webhook reaches your server.
3. You should see the ping appear in the **Recent Webhook Deliveries** table on the Prisom Integrations → GitHub page.

---

## Step 5 — Test the full pipeline

| Action | Expected result |
|---|---|
| Push a commit to a tracked repo | Repo appears in Detected Repositories (if not yet imported) or commits are synced (if already imported). Delivery logged with `push / synced`. |
| Uninstall the app | `installation / deleted` delivery is logged. (Cleanup not yet implemented.) |
| Import a detected repo | Creates a project and links the repo. Subsequent pushes are synced automatically. |
| Link a detected repo to an existing project | Moves the detected entry, links repo to project. |
| Click Sync button | Runs `syncProjectFromGitHub` manually; creates a `GitSyncRun` record. |

---

## Private key format

The `GITHUB_APP_PRIVATE_KEY` env var must be a **single line** with literal `\n`
characters replacing actual newlines. To convert a downloaded `.pem` file:

```bash
# macOS / Linux
awk 'NF{printf "%s\\n", $0}' ~/Downloads/your-app.2024-01-01.private-key.pem
```

Paste the output (starting with `-----BEGIN RSA PRIVATE KEY-----\n...`) into your
`.env` file, surrounded by double quotes:

```env
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n"
```

Do **not** use single quotes — they prevent the `\n` sequences from being
interpreted by the Node.js process.

---

## Common errors and fixes

### `401 Invalid signature`

- Make sure `GITHUB_WEBHOOK_SECRET` in `.env` matches exactly what you entered in the GitHub App's Webhook Secret field.
- If you just need to test without a tunnel, temporarily set `GITHUB_WEBHOOK_DEV_BYPASS=true` (development only — resets on next restart).

### `No workspace found — run db:seed first`

The webhook route looks up the first workspace in the database. Run:

```bash
npm run db:seed
```

### App not installed / repos not appearing

- Verify the GitHub App is installed on your account/org and the repository is selected.
- Check **App settings → Advanced → Recent Deliveries** on GitHub to see whether deliveries are reaching Prisom. A delivery error will show you the HTTP status and response body.

### Missing installation ID

Repositories imported before the first push may not have an `installationId`. The
next push or `installation_repositories` event will capture it automatically.

### Private key newline issue

If sync throws `error:0909006C:PEM routines:get_name:no start line`, your private
key has incorrect formatting. Regenerate the escaped value with the `awk` command
above.

### Rate limit

GitHub App installations are limited to 5,000 API requests per hour per
installation token. The sync route calls the REST API only for full syncs
(`syncProjectFromGitHub`). Webhook-driven push syncs use no API calls.

### Repo not showing after push

Pushes to branches other than the default branch are fully synced if the repo is
already imported. If it's not imported, any push creates a detected repo entry
regardless of branch. Check the **Recent Webhook Deliveries** table for the
delivery status and message.
