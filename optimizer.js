/*
 * Split Cart optimizer: parses a grocery list, matches it against a price
 * book, and picks the cheapest way to split the order between stores once
 * package sizes, order minimums and delivery fees are counted.
 *
 * Works as a browser global (window.GroceryOptimizer) and a CommonJS module.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GroceryOptimizer = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const STORES = ['walmart', 'sams'];
  const STORE_NAMES = { walmart: 'Walmart', sams: "Sam's Club" };
  const BRUTE_FORCE_LIMIT = 16;

  // Unit words that may follow a quantity ("3 lb bananas"). They are dropped
  // because each price-book item already carries its own unit.
  const UNIT_WORDS = new Set([
    'lb', 'lbs', 'pound', 'pounds', 'oz', 'ounce', 'ounces', 'fl', 'gal',
    'gallon', 'gallons', 'ct', 'count', 'pk', 'pack', 'packs', 'bag', 'bags',
    'box', 'boxes', 'can', 'cans', 'jar', 'jars', 'bottle', 'bottles',
    'loaf', 'loaves', 'roll', 'rolls', 'bunch', 'bunches', 'of',
  ]);

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function normalize(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
      .join(' ');
  }

  function stripUnits(words) {
    let multiplier = 1;
    while (words.length > 1) {
      const w = words[0].toLowerCase().replace(/\.$/, '');
      if (w === 'dozen') {
        multiplier *= 12;
        words.shift();
      } else if (UNIT_WORDS.has(w)) {
        words.shift();
      } else {
        break;
      }
    }
    return { words, multiplier };
  }

  /** Parse free-form list text into [{ name, qty, key }], merging duplicates. */
  function parseList(text) {
    const merged = new Map();
    for (let line of String(text || '').split(/\r?\n/)) {
      line = line.replace(/^\s*(?:[-*•]|\[[ xX]?\]|\d+[.)])\s+/, '').trim();
      if (!line) continue;

      let qty = 1;
      let rest = line;
      let m;
      if ((m = line.match(/^(\d+(?:\.\d+)?)\s*x?\s+(.+)$/i))) {
        qty = parseFloat(m[1]);
        rest = m[2];
      } else if ((m = line.match(/^(.+?)\s*(?:x\s*|\s)(\d+(?:\.\d+)?)$/i))) {
        rest = m[1];
        qty = parseFloat(m[2]);
      }

      const { words, multiplier } = stripUnits(rest.trim().split(/\s+/));
      qty *= multiplier;
      const name = words.join(' ').trim();
      const key = normalize(name);
      if (!key || !(qty > 0)) continue;

      if (merged.has(key)) merged.get(key).qty += qty;
      else merged.set(key, { name, qty, key });
    }
    return [...merged.values()];
  }

  /** Find the price-book item that best matches a list entry. */
  function findProduct(book, name) {
    const key = normalize(name);
    if (!key) return null;
    const names = (item) => [item.name, ...(item.aliases || [])].map(normalize).filter(Boolean);

    for (const item of book) {
      if (names(item).includes(key)) return item;
    }

    const queryTokens = new Set(key.split(' '));
    let best = null;
    let bestScore = 0;
    for (const item of book) {
      for (const n of names(item)) {
        const tokens = n.split(' ');
        const shared = tokens.filter((t) => queryTokens.has(t)).length;
        const allOfItem = shared === tokens.length;
        const allOfQuery = shared === queryTokens.size;
        if (!allOfItem && !allOfQuery) continue;
        const score = shared / Math.max(tokens.length, queryTokens.size);
        if (score > bestScore) {
          best = item;
          bestScore = score;
        }
      }
    }
    return best;
  }

  /** Cost of covering `qty` units with whole packages of an offer. */
  function costFor(offer, qty) {
    if (!offer) return null;
    const price = Number(offer.price);
    const size = Number(offer.size);
    if (!(price > 0) || !(size > 0) || !(qty > 0)) return null;
    const packs = Math.max(1, Math.ceil(qty / size - 1e-9));
    return {
      packs,
      cost: round2(packs * price),
      unitPrice: price / size,
      leftover: round2(packs * size - qty),
    };
  }

  /** Delivery or pickup fees for one store's subtotal. */
  function storeFees(subtotal, cfg) {
    if (!(subtotal > 0)) return 0;
    const minimum = Number(cfg.minimum) || 0;
    if (subtotal < minimum) {
      return cfg.blockBelowMinimum ? Infinity : Number(cfg.feeBelow) || 0;
    }
    return Number(cfg.feeAbove) || 0;
  }

  function evaluate(lines, assignment, settings) {
    const stores = {};
    for (const s of STORES) stores[s] = { subtotal: 0, fees: 0, total: 0, lines: [] };
    lines.forEach((line, i) => {
      const s = assignment[i];
      stores[s].subtotal += line.options[s].cost;
      stores[s].lines.push(line);
    });
    let total = 0;
    let used = 0;
    for (const s of STORES) {
      const st = stores[s];
      st.subtotal = round2(st.subtotal);
      st.fees = storeFees(st.subtotal, settings.stores[s]);
      st.total = round2(st.subtotal + st.fees);
      if (st.lines.length) used++;
      total += st.subtotal + st.fees;
    }
    const hassle = used > 1 ? Number(settings.splitHassle) || 0 : 0;
    return { stores, hassle, total: round2(total), score: total + hassle };
  }

  /**
   * Choose a store for every priced item so that item costs plus store fees
   * (plus the optional "hassle" charge for using two stores) are lowest.
   */
  function optimize(list, book, settings) {
    const enabled = STORES.filter((s) => settings.stores[s] && settings.stores[s].enabled !== false);
    const lines = [];
    const unmatched = [];
    const unpriced = [];

    for (const entry of list) {
      const item = findProduct(book, entry.name);
      if (!item) {
        unmatched.push(entry);
        continue;
      }
      const options = {};
      for (const s of STORES) {
        options[s] = enabled.includes(s) ? costFor(item.offers && item.offers[s], entry.qty) : null;
      }
      const choices = enabled.filter((s) => options[s]);
      if (!choices.length) {
        unpriced.push({ ...entry, item });
        continue;
      }
      lines.push({ ...entry, item, options, choices });
    }

    const cheapest = (line) =>
      line.choices.reduce((a, b) => (line.options[b].cost < line.options[a].cost ? b : a));

    const candidates = [];
    const push = (assignment) => candidates.push({ assignment, result: evaluate(lines, assignment, settings) });

    const greedy = lines.map(cheapest);
    push(greedy);
    for (const s of enabled) {
      push(lines.map((line) => (line.options[s] ? s : cheapest(line))));
    }

    const free = lines.map((l, i) => (l.choices.length > 1 ? i : -1)).filter((i) => i >= 0);
    if (free.length <= BRUTE_FORCE_LIMIT) {
      for (let mask = 0; mask < 1 << free.length; mask++) {
        const assignment = greedy.slice();
        free.forEach((idx, bit) => {
          assignment[idx] = lines[idx].choices[(mask >> bit) & 1];
        });
        push(assignment);
      }
    } else {
      // Too many items to try every split: improve each start by single moves.
      for (const start of candidates.slice()) {
        const assignment = start.assignment.slice();
        let current = evaluate(lines, assignment, settings);
        let improved = true;
        while (improved) {
          improved = false;
          for (const i of free) {
            const prev = assignment[i];
            assignment[i] = lines[i].choices.find((s) => s !== prev);
            const next = evaluate(lines, assignment, settings);
            if (next.score < current.score - 1e-9) {
              current = next;
              improved = true;
            } else {
              assignment[i] = prev;
            }
          }
        }
        push(assignment);
      }
    }

    let best = candidates[0];
    for (const c of candidates) if (c.result.score < best.result.score - 1e-9) best = c;

    const singleStore = {};
    for (const s of enabled) {
      if (lines.every((l) => l.options[s])) {
        singleStore[s] = evaluate(lines, lines.map(() => s), settings).total;
      } else {
        singleStore[s] = null;
      }
    }

    const plan = best.assignment.map((store, i) => {
      const line = lines[i];
      const other = line.choices.find((s) => s !== store);
      const hint =
        other && line.options[other].unitPrice < line.options[store].unitPrice * 0.9
          ? {
              store: other,
              percent: Math.round((1 - line.options[other].unitPrice / line.options[store].unitPrice) * 100),
            }
          : null;
      return { ...line, store, chosen: line.options[store], unitHint: hint };
    });

    return {
      plan,
      stores: best.result.stores,
      total: best.result.total,
      hassle: best.result.hassle,
      feasible: Number.isFinite(best.result.total),
      singleStore,
      unmatched,
      unpriced,
    };
  }

  return {
    STORES,
    STORE_NAMES,
    normalize,
    parseList,
    findProduct,
    costFor,
    storeFees,
    optimize,
  };
});
