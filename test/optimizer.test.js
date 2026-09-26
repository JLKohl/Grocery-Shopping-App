const test = require('node:test');
const assert = require('node:assert/strict');
const { parseList, findProduct, costFor, storeFees, optimize } = require('../optimizer.js');

const noFees = {
  splitHassle: 0,
  stores: {
    walmart: { enabled: true, minimum: 0, feeBelow: 0, feeAbove: 0 },
    sams: { enabled: true, minimum: 0, feeBelow: 0, feeAbove: 0 },
  },
};

const book = [
  {
    name: 'Milk',
    unit: 'gal',
    offers: { walmart: { size: 1, price: 3.48 }, sams: { size: 2, price: 6.24 } },
  },
  {
    name: 'Eggs',
    unit: 'egg',
    offers: { walmart: { size: 12, price: 2.97 }, sams: { size: 36, price: 7.98 } },
  },
  {
    name: 'Bread',
    unit: 'loaf',
    offers: { walmart: { size: 1, price: 2.24 }, sams: { size: 2, price: 4.98 } },
  },
  { name: 'Paper towels', unit: 'roll', offers: { walmart: { size: 6, price: 9.97 } } },
];

test('parseList handles quantities, units, dozens and duplicates', () => {
  const items = parseList('- 2 milk\neggs x 18\n[ ] 1 dozen eggs\n3 lb bananas\nbread\n\n');
  assert.deepEqual(
    items.map((i) => [i.name, i.qty]),
    [
      ['milk', 2],
      ['eggs', 30],
      ['bananas', 3],
      ['bread', 1],
    ],
  );
});

test('findProduct matches plurals and partial names', () => {
  assert.equal(findProduct(book, 'egg').name, 'Eggs');
  assert.equal(findProduct(book, 'paper towel').name, 'Paper towels');
  assert.equal(findProduct(book, 'whole milk').name, 'Milk');
  assert.equal(findProduct(book, 'kale'), null);
});

test('costFor buys whole packages', () => {
  assert.deepEqual(costFor({ size: 12, price: 3 }, 18), { packs: 2, cost: 6, unitPrice: 0.25, leftover: 6 });
  assert.equal(costFor({ size: 0, price: 3 }, 1), null);
  assert.equal(costFor(undefined, 1), null);
});

test('storeFees applies minimums', () => {
  const cfg = { minimum: 35, feeBelow: 6.99, feeAbove: 0 };
  assert.equal(storeFees(0, cfg), 0);
  assert.equal(storeFees(20, cfg), 6.99);
  assert.equal(storeFees(40, cfg), 0);
  assert.equal(storeFees(20, { ...cfg, blockBelowMinimum: true }), Infinity);
});

test('without fees each item goes to its cheapest store', () => {
  const r = optimize(parseList('2 milk\n12 eggs\nbread'), book, noFees);
  const byName = Object.fromEntries(r.plan.map((l) => [l.item.name, l.store]));
  assert.deepEqual(byName, { Milk: 'sams', Eggs: 'walmart', Bread: 'walmart' });
  assert.equal(r.total, round(6.24 + 2.97 + 2.24));
});

test('a small-order fee pulls everything into one store', () => {
  const settings = {
    splitHassle: 0,
    stores: {
      walmart: { enabled: true, minimum: 35, feeBelow: 6.99, feeAbove: 0 },
      sams: { enabled: true, minimum: 50, feeBelow: 12, feeAbove: 0 },
    },
  };
  const r = optimize(parseList('2 milk\n12 eggs\nbread'), book, settings);
  assert.ok(r.plan.every((l) => l.store === 'walmart'));
  assert.equal(r.total, round(3.48 * 2 + 2.97 + 2.24 + 6.99));
  assert.equal(r.singleStore.walmart, r.total);
});

test('items only one store sells stay there; unknown items are reported', () => {
  const r = optimize(parseList('paper towels\nkale'), book, noFees);
  assert.equal(r.plan[0].store, 'walmart');
  assert.deepEqual(r.unmatched.map((u) => u.name), ['kale']);
  assert.equal(r.singleStore.sams, null);
});

test('disabling a store moves everything to the other', () => {
  const settings = { ...noFees, stores: { ...noFees.stores, sams: { ...noFees.stores.sams, enabled: false } } };
  const r = optimize(parseList('2 milk'), book, settings);
  assert.equal(r.plan[0].store, 'walmart');
});

test('split hassle keeps the order in one store when savings are small', () => {
  const r = optimize(parseList('2 milk\nbread'), book, { ...noFees, splitHassle: 5 });
  assert.equal(new Set(r.plan.map((l) => l.store)).size, 1);
});

test('large lists use local search and still beat single-store totals', () => {
  const big = [];
  let text = '';
  for (let i = 0; i < 24; i++) {
    big.push({
      name: `product ${String.fromCharCode(97 + i)}`,
      offers: { walmart: { size: 1, price: 2 + (i % 3) }, sams: { size: 1, price: 2 + ((i + 1) % 3) } },
    });
    text += `product ${String.fromCharCode(97 + i)}\n`;
  }
  const settings = {
    splitHassle: 0,
    stores: {
      walmart: { enabled: true, minimum: 35, feeBelow: 6.99, feeAbove: 0 },
      sams: { enabled: true, minimum: 50, feeBelow: 12, feeAbove: 0 },
    },
  };
  const r = optimize(parseList(text), big, settings);
  assert.equal(r.plan.length, 24);
  assert.ok(r.total <= Math.min(r.singleStore.walmart, r.singleStore.sams));
});

function round(n) {
  return Math.round(n * 100) / 100;
}
