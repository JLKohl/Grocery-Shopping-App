# Grocery Shopper

Paste your grocery list into a page on your computer and click **Shop**. It never checks out: when it's done you review each cart and place the orders.

A run has two steps:

1. **Check prices.** Claude Code opens Chrome and looks up each item at **Walmart** and **Sam's Club**. It starts from your past purchases so it prices your usual brands. For each store it records the product, package size, price and link.
2. **Plan, then fill the carts.** The app's own tested code (`optimizer.js`, via `shopper/plan.js`) picks the store for each item. It counts whole packages, price per unit, each store's order minimum and fee, and your "only split if it saves at least" amount. Claude then adds exactly those products to each cart.

The page shows both stores' prices for every item, which one you're buying and why, and whether it made it into the cart.

## Install on your Mac (once)

You need Node.js, Claude Code (signed in) and Google Chrome.

1. Download this project: on GitHub, switch to this branch, click **Code → Download ZIP**, and double-click the ZIP to unzip it.
2. Open **Terminal** (press ⌘-Space, type Terminal, press Return).
3. Type `bash ` (with a space after it). Then drag `install.sh` from the unzipped folder's `mac` folder into the Terminal window and press Return.

The installer puts **Grocery Shopper** in your Applications folder and opens it. You can delete the downloaded folder afterwards. To update later, download the new version and run the installer again. Your store sign-ins are kept.

## Use it

1. Open **Grocery Shopper** from Launchpad or Spotlight. It opens a page in your browser.
2. The first time, click **Sign in to stores**. Sign in to Walmart and Sam's Club in the Chrome window that opens (tick "Keep me signed in"), then close that window.
3. Paste your list, add any notes ("paper goods at Sam's", "organic strawberries") and click **Shop**. Leave the Chrome window alone while it works. A 20-item list usually takes 10 to 15 minutes.
4. When it finishes, the page lists what went in each cart and anything it couldn't find. Use the **Review cart** buttons to check and place your orders.

- If the page says **Needs you**, a store is showing a "press and hold" robot check. Complete it in the Chrome window and Claude carries on.
- Set order minimums and fees under **Fees and minimums** on the page. Defaults: Walmart $6.99 under $35, Sam's Club $12 under $50.
- To change how Claude picks products (brands, bulk rules), edit `~/Library/Application Support/Grocery Shopper/shopper/gather.md`. How it fills carts is in `fill.md` next to it.
- The app runs quietly in the background and quits itself after an hour of not being used. If something goes wrong, details are in `~/Library/Logs/Grocery Shopper.log`.
- To remove everything, run `bash ~/Library/Application\ Support/Grocery\ Shopper/mac/uninstall.sh` in Terminal.

The shopping Chrome window uses its own profile, so it doesn't touch your everyday Chrome.

### Without the Mac app

In the project folder: `npm install`, then `npm run shop`. This works on Windows and Linux too.

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
- `index.html`: the Split Cart page.
- `shopper/`: Grocery Shopper. `server.js` runs Claude Code, `plan.js` turns collected prices into a plan, `gather.md` and `fill.md` are the instructions Claude follows.
