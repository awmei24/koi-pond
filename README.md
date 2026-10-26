# Koi Pond

A top-down, interactive koi pond. Drag through the water to make ripples; tap to scatter food.

## Run it

No build step. Open `index.html` in a browser, or serve the folder:

```sh
npx serve .        # or: python3 -m http.server 8000
```

## Interactions

- **Drag**: your hand moves through the water, pushing ripples, lily pads and leaves. Nearby koi dart away.
- **Tap**: drops food pellets. Koi startle at the splash, then come to eat.
- Multi-touch works; each finger is its own hand.
- **Time & season** follow your clock: light moves from dawn to night, and the leaves change from cherry petals (spring) to green (summer), maple and ginkgo (autumn) and a few withered ones (winter). Preview any time with `?hour=21.5&month=1` (month 1–12), e.g. `index.html?hour=19&month=10`.
- **Sound** starts on your first touch (browsers require one). Toggle it with the button in the top-right or the **M** key.
