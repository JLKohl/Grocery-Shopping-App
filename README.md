# Grocery Shopper

Paste your grocery list into a page on your computer and click **Shop**. Claude Code opens Chrome, compares prices at **Walmart** and **Sam's Club**, and puts each item in the cart of the cheaper store. It starts from your past purchases so you get your usual brands. It never checks out: when it's done you review each cart and place the orders.

## What you need

- Node.js 18 or newer
- Claude Code, signed in (`claude --version` works in a terminal)
- Google Chrome

## Set up (once)

1. Download this project: on GitHub, choose **Code → Download ZIP** and unzip it, or `git clone` it.
2. Open a terminal in the project folder and run:
   ```sh
   npm install
   npm run login
   ```
3. A Chrome window opens with Walmart and Sam's Club sign-in pages. Sign in to both (tick "Keep me signed in"), then close the window.

This Chrome window uses its own profile, kept in `shopper/.chrome-profile`. It doesn't touch your everyday Chrome, and you'll stay signed in there for future runs.

## Shop

```sh
npm run shop
```

The page opens at http://localhost:4321. Paste your list, add any notes ("paper goods at Sam's", "organic strawberries") and click **Shop**. Leave the Chrome window alone while it works. A 20-item list usually takes 10 to 15 minutes.

- If the page says **Needs you**, a store is showing a "press and hold" robot check. Complete it in the Chrome window and Claude carries on.
- When it finishes, the page lists what went in each cart and anything it couldn't find. Use the **Review cart** buttons to check and place your orders.
- To change how Claude shops (brands, bulk rules, the $50 Sam's minimum), edit `shopper/instructions.md`.

### Good to know

- Each run uses your Claude plan's usage like any other Claude Code task.
- Walmart and Sam's Club don't permit automated use of their sites. Occasional personal shopping is unlikely to be noticed, but they could flag your account.
- The page and server only answer on this computer (`localhost`). Claude Code is only allowed to use the browser tool, so it can't run commands or edit files.

---

# Split Cart (price calculator)

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
