# Account mode

The account mode is a local implementation for a separate HTTPS Node 24 server. The GitHub Pages site continues to serve a public demo. Do not use account mode with a temporary filesystem or the original app's environment or database.

## Activate GitHub sign-in

1. Register a dedicated [GitHub OAuth App](https://github.com/settings/applications/new). Use **The Database Public** for the name, the public site for the homepage, and `https://jwadtknlsmotjisomppx.supabase.co/auth/v1/callback` for the authorization callback URL.
2. Enable GitHub under [Supabase Authentication Providers](https://supabase.com/dashboard/project/jwadtknlsmotjisomppx/auth/providers), paste the OAuth Client ID and Client Secret directly in the provider settings, and save.
3. When the account backend has a stable HTTPS origin, allowlist `https://<account-host>/account-api/callback` as an exact redirect URL in the project's Authentication URL Configuration. Use the account host for the project Site URL.

## Run the account backend

Configure these at the host:

- `DEMO_ACCOUNT_ORIGIN` is the public HTTPS origin for the clone's Node service.
- `DEMO_ACCOUNT_DB` is an absolute SQLite path on the clone's persistent volume outside the public document root.
- `DEMO_ACCOUNT_ENCRYPTION_KEY` is a separately backed up, server-only, 32-byte key encoded as 64 hexadecimal characters.
- `DEMO_AUTH_URL` is `https://jwadtknlsmotjisomppx.supabase.co`.
- `DEMO_AUTH_PUBLISHABLE_KEY` is the publishable key from the new Supabase project.

Build with `node build.mjs` and run `node serve.mjs` behind the host's HTTPS reverse proxy. The Node server binds to loopback. Keep the same origin for the dashboard and its account API. The sign-in button appears when the backend confirms account mode.

Run the sign-in and connection flow with two separate test identities and separately configured Alpaca Paper keys. Use each account to confirm its own balance and connection state. Confirm that signing out clears the browser session and that disconnecting one identity leaves the other identity's paper connection in place.

The account dialog currently supports connecting, viewing, and disconnecting an Alpaca Paper balance. It does not place orders. Existing dashboard charts and world data retain their demo labels. The shared bot, Robinhood, account usage and device push require separate per-user integration work.

## Hosted account storage

For the Render deployment, use `HOST=0.0.0.0`, Node 24, build command `node --test && node build.mjs`, and start command `node serve.mjs`. Set `DEMO_SUPABASE_SECRET_KEY` to a new server-only secret from the clone project in the Render dashboard. This replaces the SQLite path on Render. Also set the HTTPS account origin, publishable key, Supabase URL, and encryption key documented above. Both secret values belong in Render environment settings only.

The Supabase clone owns the encrypted connection table. Anonymous and signed-in browser roles have no access to this table. Render's free service may sleep and cannot run a continuous paper-trading worker.
