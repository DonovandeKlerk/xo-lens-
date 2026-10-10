# XO Lens

An independent companion for XO Market. Explore current markets, inspect live prices and order books, model a position, and save a decision journal in your browser.

## Run locally

```bash
python3 -m http.server 4173 --directory dist
```

Open http://localhost:4173. Publish the contents of `dist/` with any static web host.

## Features

- Current market discovery and links to the original XO events
- Real price history and live order-book data
- Yes/No scenario planning, costs, break-even, and expected results
- Market rules, notes, and local journal export
- Dark interface, animated X/O artwork, and optional background music

Saved plans stay in browser local storage. No wallet connection or trading is performed. Prices are indicative. This is an independent project, not affiliated with XO Market.

## Source

The complete static site is in `dist/`. Deployment settings, credentials, generated deployment bundles, and local development files are intentionally excluded.

## License

Project code is MIT licensed; see [LICENSE](LICENSE). Bundled third-party libraries and fonts retain their respective licenses. The background audio is a separate media asset.
