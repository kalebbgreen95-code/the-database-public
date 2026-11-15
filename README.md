# The Database · Public Demo

The public edition of The Database uses the v1.5.192 dashboard markup, styling and UI interactions with a simulation-only replay bot. It includes Overview, Search and asset charts, Demo Portfolio, Watchlist, Potential Buys, AI Watchlist, Crypto, News, Paper Trading and an in-app notification inbox. The app uses a static snapshot and exposes no write, admin, or deployment endpoints. The synthetic watchlist, account, and fills are generated from scratch. Equity, ETF, and crypto prices and checklist values are illustrative. U.S. Treasury yields and Federal Reserve releases are public observations and are shown separately with source dates and links.

## Run locally

Use Node.js 24 or later. No dependencies, accounts, or keys are required.

    node --test
    node build.mjs
    node serve.mjs

Open http://127.0.0.1:4173. Use `node build.mjs --offline` for a fully offline build. If the feeds are unreachable, the demo still builds and marks the public data unavailable.

## Publish on GitHub Pages

1. Create an **empty public** GitHub repository named `the-database-public`. Do not fork or import an existing repository.
2. Push this directory to its `main` branch as a fresh history. The included workflow is in `.github/workflows/pages.yml`. Push with a GitHub account that may create workflow files.
3. In the new repository, open **Settings → Pages → Build and deployment → Source → GitHub Actions**. Then open **Actions → Build and publish public demo → Run workflow → main**.
4. Open the URL reported by the deploy job in a signed-out window. Confirm the Overview loads, the simulated fills appear under Paper Trading, and no routes outside the static file set expose data.

Pages hosts only `dist/`, and the standard GitHub-hosted runner builds it daily at 22:23 UTC, including with the owner's PC off. The schedule may run late, and GitHub can disable it after 60 days of inactivity in a public repository. Re-enable it from Actions and run it manually if needed. The site keeps serving the last deployed snapshot while jobs are delayed. GitHub Pages lists a 1 GB site limit and a soft 100 GB/month bandwidth limit; the build uses no other hosted service or paid runner.

## Bot, data and storage

The scheduled job starts with $5,000 in fresh demo cash and replays 30 completed UTC days of generated bars. It carries over the stock checklist, minute pullback and reversal checks, crypto intraday momentum and exits, daily crypto allocation signal, historical comparison, BTC filter experiment, and technical indicators. The adapted executor uses fixed $250 entries, skips synthetic stock/ETF sessions on weekends, and never calls an order API. It models fills on synthetic bars; it does not model a real exchange calendar, slippage, spreads, broker execution, or adaptive sizing. The public research panels run the comparison algorithms on synthetic candles. It discards the ledger at the beginning of each replay window. Published storage is one public snapshot in the Pages deployment.

`lib/providers.mjs` defines the build-side data adapter. The current adapter returns `{treasury, headlines}`, with a neutral unavailable state for each feed. Public data comes from the [Treasury daily XML feed](https://home.treasury.gov/treasury-daily-interest-rate-xml-feed) and [Federal Reserve RSS](https://www.federalreserve.gov/feeds/feeds.htm). The runner requests months and parses only selected columns and valid links. No visitor input is sent to a feed provider.

For future licensed quotes or a different host, add a build-side adapter that normalizes approved fields and restricts the exported data to what the provider permits for public display. Put any future secrets in the runner's secret store, and never pass them through the snapshot builder. The static output can be published on another static host while keeping the same scheduled build. No paid provider or hosting service is enabled.

[Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) · [Scheduled workflow limits](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
