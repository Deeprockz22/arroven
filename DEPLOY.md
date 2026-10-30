# Deploy ARROVEN to Railway

This gives the app a permanent private link. The app runs from the `Dockerfile`, with a managed Postgres database and a
volume for uploaded records.

Access is private. Only the email addresses in the `ALLOWED_EMAILS` variable can create an account, sign in or stay signed
in, and every page, including the overview, requires sign-in. If the variable is missing, nobody can get in. The first
listed person to sign up becomes the owner; everyone after that also needs an invite link from the owner.

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
   | `ALLOWED_EMAILS` | The addresses allowed in, separated by commas | Everyone else is refused, even with a valid password |

2. **Settings → Volumes → Add volume**, mount path **`/data`**. Uploaded originals are stored there and survive redeploys.
3. **Settings → Region**: choose the region closest to India that Railway offers (for example Southeast Asia).
4. **Settings → Networking → Generate domain.** This is your link, like `arroven-production.up.railway.app`.

Railway redeploys after these changes. Migrations run automatically on every start.

## 3. Set it up and invite your friend

1. Open `<your link>/signup` and create the owner account with an address on `ALLOWED_EMAILS`. After that, sign-up closes.
2. On the cases page, choose **Load demo case**.
3. **Settings → Members → Invite**: enter the other listed address and pick **Reviewing engineer**. Send them the link it
   shows. They create their account from that link and see the demo case.

To give someone access later, add their address to `ALLOWED_EMAILS` and invite them. To remove someone, take their address
off the list: they are signed out on their next page load.

Invite links use the address people reach the site on. To pin it, add a variable `APP_URL` with your Railway link.

## Notes

- No model service is configured, so drafting runs on the clearly labelled offline mock. Set `MODEL_SERVICE_URL` and
  `MODEL_SERVICE_TOKEN` once ARROVEN's own models are served.
- Use the fictional demo case only. Real partner records need the signed data-sharing agreement first.
- Railway bills by usage; check its current plans before leaving the service running long term.
