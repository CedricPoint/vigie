<h1 align="center">Vigie</h1>

<p align="center">
  <strong>Self-hosted uptime monitoring and public status page.</strong><br>
  One small Node.js process. No database. Alerts on Discord, Slack, Telegram, ntfy or any webhook.
</p>

<p align="center">
  <a href="https://www.hostinger.com/deploy?template=CedricPoint/vigie&ref=YOUR_PARTNER_CODE"><img src="https://assets.hostinger.com/vps/deploy.svg" alt="Deploy on Hostinger"></a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933" alt="Node.js 20 or newer">
  <img src="https://img.shields.io/badge/dependencies-1-brightgreen" alt="One dependency">
</p>

---

Vigie (French for *lookout*) checks your websites and servers every minute, tells you the moment one goes down,
and gives your users a clean status page with 90 days of history. It is built to be the simplest thing that does the job:
`npm start` and you are done.

## Features

- **Website checks**: HTTP/HTTPS with accepted status codes, a text that must appear in the page, GET/HEAD/POST.
- **Server checks**: any TCP port (databases, mail servers, game servers, SSH…).
- **SSL certificate watch**: warns you 14 days before a certificate expires.
- **Alerts** on Discord, Slack, Telegram, ntfy and generic webhooks, with a test button. No alert spam: a service is
  only marked down after the number of failed retries you choose, and you get one message when it comes back with the downtime.
- **Public status page** with an overall banner, 90-day uptime bars, average response time, ongoing and past incidents.
  Works without JavaScript, refreshes itself every minute, light and dark mode, readable on phones.
- **Incidents and maintenance**: post an incident, add updates, resolve it. It shows on the status page.
- **README badges**: `![status](https://status.example.com/badge/<id>.svg)` or uptime badges for 24h/7d/30d/90d.
- **JSON API**: `GET /api/status` for your own integrations.
- **English and French** interface.
- **Tiny footprint**: one dependency (Express), data stored in two JSON files, runs on the smallest plan.

## Deploy

### One click on Hostinger

[![Deploy on Hostinger](https://assets.hostinger.com/vps/deploy.svg)](https://www.hostinger.com/deploy?template=CedricPoint/vigie&ref=YOUR_PARTNER_CODE)

Works on **Web apps hosting** (Node.js) and on **VPS** (Docker Compose). Open the site once deployed: the first visit
asks you to choose the admin password.

### Docker

```bash
docker run -d --name vigie -p 3000:3000 -v vigie-data:/data --restart unless-stopped ghcr.io/cedricpoint/vigie:latest
```

Or with Docker Compose, using the [`docker-compose.yml`](docker-compose.yml) of this repository:

```bash
docker compose up -d
```

### Node.js

```bash
git clone https://github.com/CedricPoint/vigie.git
cd vigie
npm install --omit=dev
npm start
```

Then open http://localhost:3000. Requires Node.js 20 or newer.

## Configuration

Everything is configured from the dashboard (`/admin`). A few environment variables exist for hosting:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Port of the web server. |
| `ADMIN_PASSWORD` | *(empty)* | Admin password. When empty, you choose it in the browser on the first visit. |
| `DATA_DIR` | `./data` (`/data` in Docker) | Where the two data files are stored. Keep it on a persistent volume. |
| `VIGIE_LANG` | `en` | Language on first start (`en` or `fr`). Can be changed later in Settings. |
| `TRUST_PROXY` | private networks | Reverse proxies trusted for the client IP: a hop count, `true`, or a list of IPs. |

> **Tip:** set `ADMIN_PASSWORD` when you deploy on a public address, so nobody can reach the first-visit setup page before you.

### Alerts

| Service | What to paste |
| --- | --- |
| Discord | Channel settings → Integrations → Webhooks → *Copy webhook URL* |
| Slack | An [incoming webhook](https://api.slack.com/messaging/webhooks) URL |
| Telegram | The token from [@BotFather](https://t.me/BotFather) and your chat ID |
| ntfy | The topic URL, e.g. `https://ntfy.sh/my-secret-topic` (plus a token for protected topics) |
| Webhook | Any URL. Vigie sends `POST` JSON: `event` (`down`, `up`, `cert`, `test`), `title`, `message`, `monitor`, `error`, `time` |

### Badges

Click the copy icon next to a public monitor to get its Markdown. Options:

- `/badge/<id>.svg`: current status
- `/badge/<id>.svg?type=uptime&period=30d`: uptime over `24h`, `7d`, `30d` or `90d`
- `&label=My%20API`: custom label

## Data and backups

Vigie stores everything in `DATA_DIR`:

- `vigie.json`: monitors, alert channels, incidents and settings
- `history.json`: check results (last 24 hours in detail, daily totals for 120 days)

Copy that folder to back up, or use *Settings → Download backup*. Writes are atomic, so a crash never leaves a half-written file.

## Development

```bash
npm install
npm run dev   # restarts on file changes
npm test      # end-to-end tests
```

The code is small on purpose: `src/monitor.js` runs the checks, `src/notify.js` sends alerts, `src/server.js` holds the
routes and `public/admin.js` is the dashboard (plain JavaScript, no build step).

## En français

Vigie surveille vos sites et serveurs, vous alerte dès qu'un service tombe (Discord, Slack, Telegram, ntfy, webhook)
et publie une page de statut avec 90 jours d'historique. L'interface est disponible en français : choisissez la langue
au premier lancement ou dans *Réglages*. Déploiement en un clic avec le bouton Hostinger ci-dessus, ou avec Docker ou Node.js.

## License

[MIT](LICENSE)
