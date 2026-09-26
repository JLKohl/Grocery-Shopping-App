# Split Cart

Paste a grocery list. Split Cart decides what to buy at **Walmart** and what to buy at **Sam's Club** for the lowest total. It counts:

- **Whole packages.** Needing 18 eggs means two 12-packs at Walmart or one 36-pack at Sam's.
- **Order minimums and fees.** A small Sam's order that triggers a delivery fee can cost more than it saves.
- **Your "hassle" threshold.** The order is only split across two stores if that saves at least this many dollars.

It then shows one list per store with links to search each item, a copy button, and a comparison with buying everything at one store.

## What it can't do

Walmart and Sam's Club don't offer a public API for placing orders or reading live prices on a shopper's behalf. So Split Cart uses a **price book**, the prices you save for each item. The **Check** links open each store's search so you can update prices. Checkout stays with you: use the per-store lists to fill your carts.

## Run it

Open `index.html` in a browser. There's no build step and nothing to install. The price book, list and settings are saved in that browser's local storage. Use **Back up or restore the price book** to move them to another device.

## Develop

```sh
npm test        # optimizer unit tests (node:test, no dependencies)
npm run build   # writes dist/split-cart.html, a single-file copy with the optimizer inlined
```

- `optimizer.js`: list parsing, item matching, package math and the store-assignment search. It tries every split for up to 16 items that both stores sell; for longer lists it improves the best single-store and cheapest-per-item plans by moving one item at a time.
- `index.html`: the app UI.
