# Set Dojo – vanilla static site

This is a dependency-free static site for training **Set** recognition. It includes four modes:

- Passive
- Pair
- Set / No Set
- Active

The site is mobile-first, uses only `index.html`, `styles.css`, `app.js`, and nine replaceable symbol images.

## Files

- `index.html` – markup and UI structure
- `styles.css` – layout, theming, card styling, exposed color variables
- `app.js` – game logic, timers, rendering, localStorage persistence
- `assets/symbols/*.png` – the 9 replaceable base images

## Replace the 9 symbol images

The app uses these files:

- `assets/symbols/00-open-squiggle.png`
- `assets/symbols/01-open-oval.png`
- `assets/symbols/02-open-diamond.png`
- `assets/symbols/03-striped-squiggle.png`
- `assets/symbols/04-striped-oval.png`
- `assets/symbols/05-striped-diamond.png`
- `assets/symbols/06-solid-squiggle.png`
- `assets/symbols/07-solid-oval.png`
- `assets/symbols/08-solid-diamond.png`

You can replace them with your own PNGs while keeping the same filenames.

### Recommended replacement format

- transparent PNG background
- single-color alpha mask style is ideal
- roughly similar aspect ratio for best visual balance

## Recolor all cards in one place

Edit these variables at the top of `styles.css`:

```css
:root {
  --set-color-0: #d95b7a;
  --set-color-1: #33b579;
  --set-color-2: #7f6bff;
}
```

Those three variables drive all card symbol colors.

## Timing settings

The UI exposes three timing controls and persists them in `localStorage`:

- reveal after
- show each reveal for
- pause between reveals

## Run locally

Because this is a plain static site, you can either:

1. open `index.html` directly in a browser, or
2. serve the folder with a tiny local server

Example with Python:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/`.

## Notes

- The board is generated from the full 81-card Set deck.
- Passive and Pair always generate boards with at least one set.
- Set / No Set mixes set and no-set boards.
- Active occasionally generates no-set boards so the `No set` action matters.
