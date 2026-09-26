// Turns the prices Claude collected into a shopping plan using the tested
// optimizer, so the "which store" decision is plain arithmetic, not judgment.
const { optimize, STORES } = require('../optimizer.js');

const DEFAULT_SETTINGS = {
  splitHassle: 3,
  stores: {
    walmart: { enabled: true, minimum: 35, feeBelow: 6.99, feeAbove: 0 },
    sams: { enabled: true, minimum: 50, feeBelow: 12, feeAbove: 0 },
  },
};

const STORE_URL = {
  walmart: /^https:\/\/(www\.)?walmart\.com\//,
  sams: /^https:\/\/(www\.)?samsclub\.com\//,
};

function positive(x) {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nonNegative(x, fallback) {
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function cleanOffer(offer, store) {
  if (!offer || typeof offer !== 'object') return null;
  const size = positive(offer.size);
  const price = positive(offer.price);
  if (!size || !price) return null;
  const url = typeof offer.url === 'string' && STORE_URL[store].test(offer.url) ? offer.url : '';
  return { product: String(offer.product || '').slice(0, 200), size, price, url };
}

function normalizeSettings(input) {
  const s = input && typeof input === 'object' ? input : {};
  const out = { splitHassle: nonNegative(s.splitHassle, DEFAULT_SETTINGS.splitHassle), stores: {} };
  for (const store of STORES) {
    const d = DEFAULT_SETTINGS.stores[store];
    const c = (s.stores && s.stores[store]) || {};
    out.stores[store] = {
      enabled: c.enabled !== false,
      minimum: nonNegative(c.minimum, d.minimum),
      feeBelow: nonNegative(c.feeBelow, d.feeBelow),
      feeAbove: nonNegative(c.feeAbove, d.feeAbove),
    };
  }
  return out;
}

/**
 * gathered: { items: [{ item, need, unit, walmart: offer|null, sams: offer|null }], notFound, notes }
 * Returns a plan the page can show and Claude can follow to fill the carts.
 */
function buildPlan(gathered, rawSettings) {
  const settings = normalizeSettings(rawSettings);
  const items = gathered && Array.isArray(gathered.items) ? gathered.items : [];
  const book = [];
  const list = [];
  const seen = new Map();

  for (const it of items) {
    let name = String((it && it.item) || '').trim().slice(0, 120);
    if (!name) continue;
    // Keep names unique so each list line matches exactly one price entry.
    const count = (seen.get(name.toLowerCase()) || 0) + 1;
    seen.set(name.toLowerCase(), count);
    if (count > 1) name = `${name} (${count})`;

    const offers = {};
    for (const store of STORES) offers[store] = cleanOffer(it[store], store);
    book.push({ name, unit: String(it.unit || 'unit').slice(0, 20), offers });
    list.push({ name, qty: positive(it.need) || 1, key: name.toLowerCase() });
  }

  const result = optimize(list, book, settings);
  const enabled = STORES.filter((s) => settings.stores[s].enabled);

  const lines = result.plan.map((l) => {
    const line = {
      item: l.item.name,
      need: l.qty,
      unit: l.item.unit,
      store: l.store,
      packs: l.chosen.packs,
      cost: l.chosen.cost,
      unitHint: l.unitHint,
      offers: {},
    };
    for (const store of STORES) {
      const offer = l.item.offers[store];
      const opt = l.options[store];
      line.offers[store] = offer && opt
        ? { ...offer, packs: opt.packs, cost: opt.cost, unitPrice: Math.round(opt.unitPrice * 1000) / 1000 }
        : null;
    }
    return line;
  });

  const singles = enabled.map((s) => result.singleStore[s]).filter((v) => v != null && Number.isFinite(v));
  const bestSingle = singles.length ? Math.min(...singles) : null;

  const notFound = (gathered && Array.isArray(gathered.notFound) ? gathered.notFound : [])
    .map((n) => ({ item: String((n && n.item) || n || '').slice(0, 120), reason: String((n && n.reason) || '').slice(0, 200) }))
    .filter((n) => n.item);
  for (const u of result.unpriced) notFound.push({ item: u.item.name, reason: 'no usable price at a store you shop' });

  const stores = {};
  for (const s of STORES) {
    const st = result.stores[s];
    stores[s] = { subtotal: st.subtotal, fees: st.fees, total: st.total, count: st.lines.length };
  }

  return {
    settings,
    lines,
    stores,
    total: result.total,
    feasible: result.feasible,
    singleStore: result.singleStore,
    saving: bestSingle != null && result.feasible ? Math.round((bestSingle - result.total) * 100) / 100 : 0,
    notFound,
    notes: String((gathered && gathered.notes) || '').slice(0, 1000),
  };
}

/** The shopping instructions for the cart-filling step, one block per store. */
function cartInstructions(plan) {
  const names = { walmart: 'Walmart', sams: "Sam's Club" };
  return STORES.map((s) => {
    const lines = plan.lines.filter((l) => l.store === s);
    if (!lines.length) return `### ${names[s]}\n\nNothing to add.`;
    return `### ${names[s]}\n\n` + lines.map((l) => {
      const o = l.offers[s];
      return `- ${l.packs} × ${o.product || l.item}${o.url ? ` (${o.url})` : ''}, for "${l.item}"`;
    }).join('\n');
  }).join('\n\n');
}

module.exports = { DEFAULT_SETTINGS, normalizeSettings, buildPlan, cartInstructions };
