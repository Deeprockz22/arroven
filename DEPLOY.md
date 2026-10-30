# Deploy ARROVEN to Railway

This gives the app a permanent private link. The app runs from the `Dockerfile`, with a managed Postgres database and a
volume for uploaded records. Sign-up is invitation-only in production: the first account created becomes the owner, and
everyone after that needs an invite link.

## 1. Create the project (about 10 minutes)

1. Go to [railway.com](https://railway.com) and sign in with GitHub (the **Deeprockz22** account).
2. **New Project → Deploy from GitHub repo → Deeprockz22/arroven.** Allow Railway to read that private repository when
   GitHub asks. The first build starts; it will fail until the database is added. That is expected.
3. In the project, **+ Create → Database → PostgreSQL.**

## 2. Configure the app service

Open the **arroven** service:

1. **Variables**, add:

   | Name | Value | Why |
   | --- | --- | --- |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Connects to the Postgres you just added |
   | `RAILWAY_RUN_UID` | `0` | Lets the app write to the volume |

2. **Settings → Volumes → Add volume**, mount path **`/data`**. Uploaded originals are stored there and survive redeploys.
3. **Settings → Region**: choose the region closest to India that Railway offers (for example Southeast Asia).
4. **Settings → Networking → Generate domain.** This is your link, like `arroven-production.up.railway.app`.

Railway redeploys after these changes. Migrations run automatically on every start.

## 3. Set it up and invite your friend

1. Open your link and choose **Start a pilot**. The first account you create becomes the owner. After that, sign-up closes.
2. On the cases page, choose **Load demo case**.
3. **Settings → Members → Invite**: enter your friend's email and pick **Reviewing engineer**. Send them the link it shows.
   They create their account from that link and see the demo case.

Invite links use the address people reach the site on. To pin it, add a variable `APP_URL` with your Railway link.

## Notes

- No model service is configured, so drafting runs on the clearly labelled offline mock. Set `MODEL_SERVICE_URL` and
  `MODEL_SERVICE_TOKEN` once ARROVEN's own models are served.
- Use the fictional demo case only. Real partner records need the signed data-sharing agreement first.
- Railway bills by usage; check its current plans before leaving the service running long term.
