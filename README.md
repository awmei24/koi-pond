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
- **Sound** starts on your first touch (browsers require one). Toggle it with the button in the top-right or the **M** key.
