# Pokémon Card Collector

A lightweight, installable web app (PWA) for tracking your Pokémon TCG collection.
No app store, no account, no server of your own: it runs from GitHub Pages and stores
your collection on your phone.

## Features

- **Sets view** – every English set, grouped by series, newest first, with a percent-complete bar.
  Filter to in-progress / complete / not-started / new sets.
- **Set detail** – card grid with real card images, `+ / −` quantity per card, owned/missing/duplicates/wishlist filters, in-set search.
- **Variant tracking** – separate counts for normal, reverse holo, holo, 1st edition and W promo printings of each card.
  The tile `+ / −` adds the card's standard printing; open the card to set each variant individually.
- **Card sheet** – larger image, per-variant counts, rarity, type, illustrator, market price, and links to the Pokédex entry.
- **Pokédex view** – by region (Kanto → Paldea), shows which Pokémon you have cards of and how many.
  Tap a Pokémon to see every card ever printed of it, with yours highlighted.
- **Search** – find any card by name across all sets and add it straight to your collection.
- **Identify a card** – type the number printed on a physical card (`045/198`, `SWSH045`, or `25` + name)
  and the app shows every set that card could belong to, with pictures, so you can match the set symbol and add it.
- **Wishlist** – star cards you're hunting for.
- **Stats** – distinct cards, total cards, species covered, sets complete, estimated value, duplicates for trading, rarity breakdown.
- **Backup** – export/import JSON, export CSV.
- **Auto-updates for new sets** – checks the card database on open / when returning to the app (default every 12 h,
  configurable), flags new sets with a **NEW** badge, shows a banner and (optionally) a notification.
  Recently released sets are re-fetched daily so card images fill in as they are published.
- **Offline** – the app shell, your collection, and sets you've viewed all work offline.
- **Light / dark** theme, follows your system by default.

## Install on Android

1. Open the GitHub Pages URL for this repo in **Chrome** on your phone
   (`https://<your-user>.github.io/PokemonCollector/`).
2. Tap the **⋮ menu → Install app** (or "Add to Home screen").
3. Launch it from your home screen like any other app.

### Storage footprint

- App itself: under 100 KB.
- Set data is fetched on demand and cached (~25 KB per set you open).
- Card thumbnails are ~20 KB WebP images, cached with a cap of 400 images (≈ 8 MB max).
  Clear the cache any time from **More → Storage**.
- Your collection is stored in the browser's IndexedDB. Export a backup from **More → Backup**.

## Deploying (GitHub Pages)

GitHub Pages is free for public repositories. Two ways to publish:

1. **Deploy from a branch (no workflow needed).** Settings → Pages → Source: *Deploy from a branch*,
   pick the branch and `/ (root)`. GitHub serves the files directly. Every push republishes.
2. **GitHub Actions.** Settings → Pages → Source: *GitHub Actions*. The included workflow
   (`.github/workflows/deploy.yml`) then publishes on every push and stamps the service-worker
   version with the commit SHA. If a run fails before any job starts, push a new commit rather than
   re-running the old run.

## Running locally

It's plain HTML/CSS/JS with no build step:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Data sources

- Card and set data, card images: [TCGdex](https://tcgdex.dev) (free, no API key)
- Pokédex names and sprites: [PokéAPI](https://pokeapi.co)

Not affiliated with Nintendo, Game Freak, Creatures or The Pokémon Company.
