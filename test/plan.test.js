const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPlan, cartInstructions, normalizeSettings } = require('../shopper/plan.js');

const noFees = {
  splitHassle: 0,
  stores: {
    walmart: { minimum: 0, feeBelow: 0, feeAbove: 0 },
    sams: { minimum: 0, feeBelow: 0, feeAbove: 0 },
  },
};

const gathered = {
  items: [
    {
      item: 'milk', need: 2, unit: 'gal',
      walmart: { product: 'Great Value Whole Milk, 1 gal', size: 1, price: 3.48, url: 'https://www.walmart.com/ip/1' },
      sams: { product: "Member's Mark Whole Milk, 2 × 1 gal", size: 2, price: 6.24, url: 'https://www.samsclub.com/p/2' },
    },
    {
      item: 'eggs', need: 12, unit: 'egg',
      walmart: { product: 'Great Value Large Eggs, 12 ct', size: 12, price: 2.97, url: 'https://evil.example.com/x' },
      sams: { product: "Member's Mark Eggs, 36 ct", size: 36, price: 7.98 },
    },
    { item: 'paper towels', need: 6, unit: 'roll', walmart: { product: 'Bounty 6 rolls', size: 6, price: 11.97 }, sams: null },
    { item: 'dragonfruit', need: 1, unit: 'each', walmart: { price: 'n/a' }, sams: null },
  ],
  notFound: [{ item: 'avocados', reason: 'out of stock at both' }],
  notes: 'Prices are for pickup.',
};

test('each item goes to the cheaper store and both prices are kept', () => {
  const plan = buildPlan(gathered, noFees);
  const byItem = Object.fromEntries(plan.lines.map((l) => [l.item, l]));
  assert.equal(byItem.milk.store, 'sams');
  assert.equal(byItem.milk.offers.walmart.cost, 6.96);
  assert.equal(byItem.milk.offers.sams.cost, 6.24);
  assert.equal(byItem.eggs.store, 'walmart');
  assert.equal(byItem['paper towels'].store, 'walmart');
  assert.equal(byItem['paper towels'].offers.sams, null);
  assert.equal(plan.total, Math.round((6.24 + 2.97 + 11.97) * 100) / 100);
});

test('links that are not store pages are dropped', () => {
  const plan = buildPlan(gathered, noFees);
  const eggs = plan.lines.find((l) => l.item === 'eggs');
  assert.equal(eggs.offers.walmart.url, '');
});

test('items without a usable price are reported, with the ones Claude could not find', () => {
  const plan = buildPlan(gathered, noFees);
  assert.deepEqual(plan.notFound.map((n) => n.item), ['avocados', 'dragonfruit']);
  assert.equal(plan.notes, 'Prices are for pickup.');
});

test('the Sam\'s minimum keeps a small order at Walmart', () => {
  const plan = buildPlan(gathered, {}); // defaults: Sam's under $50 pays $12
  assert.ok(plan.lines.every((l) => l.store === 'walmart'));
  assert.equal(plan.stores.sams.count, 0);
});

test('cart instructions list each store\'s products and quantities', () => {
  const text = cartInstructions(buildPlan(gathered, noFees));
  assert.match(text, /### Sam's Club\n\n- 1 × Member's Mark Whole Milk, 2 × 1 gal \(https:\/\/www\.samsclub\.com\/p\/2\), for "milk"/);
  assert.match(text, /- 1 × Great Value Large Eggs, 12 ct, for "eggs"/);
});

test('bad settings fall back to defaults', () => {
  const s = normalizeSettings({ splitHassle: -4, stores: { sams: { minimum: 'abc', enabled: false } } });
  assert.equal(s.splitHassle, 3);
  assert.equal(s.stores.sams.minimum, 50);
  assert.equal(s.stores.sams.enabled, false);
  assert.equal(s.stores.walmart.enabled, true);
});

test('empty or malformed input gives an empty plan', () => {
  const plan = buildPlan(null, null);
  assert.deepEqual(plan.lines, []);
  assert.equal(plan.total, 0);
});
