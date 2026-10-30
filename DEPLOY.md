# Deploy ARROVEN to Render

This gives the app a permanent private link. `render.yaml` describes everything: the app built from the `Dockerfile`, a
1 GB disk at `/data` for uploaded records, and a managed Postgres database, all in Singapore (the closest Render region to
India).

Access is private. Only the email addresses in the `ALLOWED_EMAILS` variable can create an account, sign in or stay signed
in, and every page, including the overview, requires sign-in. If the variable is missing, nobody can get in. The first
listed person to sign up becomes the owner; everyone after that also needs an invite link from the owner.

## 1. Create it (about 10 minutes)

1. Go to [render.com](https://render.com) and sign in with GitHub (the **Deeprockz22** account).
2. **New → Blueprint.** Connect GitHub and allow Render to read the private **Deeprockz22/arroven** repository, then pick it.
3. Render reads `render.yaml` and lists the **arroven** web service and the **arroven-db** database. It asks for
   **`ALLOWED_EMAILS`**: enter the addresses allowed in, separated by commas.
4. Choose **Deploy Blueprint**. The first build takes about 5 minutes. Migrations run automatically on every start.

Your link is shown at the top of the **arroven** service, like `https://arroven.onrender.com`.

## 2. Set it up and invite your friend

1. Open `<your link>/signup` and create the owner account with an address on `ALLOWED_EMAILS`. After that, sign-up closes.
2. On the cases page, choose **Load demo case**.
3. **Settings → Members → Invite**: enter the other listed address and pick **Reviewing engineer**. Send them the link it
   shows. They create their account from that link and see the demo case.

To give someone access later, add their address to `ALLOWED_EMAILS` (**arroven → Environment**) and invite them. To remove
someone, take their address off the list: they are signed out on their next page load.

Invite links use the address people reach the site on. To pin it, add a variable `APP_URL` with your Render link.

## Costs

- The web service uses the **Starter** plan, because a persistent disk needs a paid plan.
- The database starts on Render's **free** plan, which expires after 30 days and is then deleted. To keep the data, change
  **arroven-db** to a paid plan before then.
- Check Render's current prices before leaving it running long term.

## Notes

- No model service is configured, so drafting runs on the clearly labelled offline mock. Set `MODEL_SERVICE_URL` and
  `MODEL_SERVICE_TOKEN` once ARROVEN's own models are served.
- Use the fictional demo case only. Real partner records need the signed data-sharing agreement first.
- The image also runs on other Docker hosts: give it `DATABASE_URL`, `ALLOWED_EMAILS` and a persistent disk at `/data`.
  `railway.json` is kept for Railway.
