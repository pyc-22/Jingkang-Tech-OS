const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const allocationSource = app.match(/function allocateRefundAmounts\(totalCents, lines\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(allocationSource, 'allocateRefundAmounts must exist');
const allocateRefundAmounts = new Function(`${allocationSource}; return allocateRefundAmounts;`)();

test('full reversal allocates a discounted paid amount across every order line', () => {
  const result = allocateRefundAmounts(29900, [
    { id: 'line-a', remainingCents: 19900 },
    { id: 'line-b', remainingCents: 19900 }
  ]);

  assert.equal(result.get('line-a'), 14950);
  assert.equal(result.get('line-b'), 14950);
  assert.equal([...result.values()].reduce((sum, amount) => sum + amount, 0), 29900);
});

test('cent rounding preserves the exact remaining paid amount', () => {
  const result = allocateRefundAmounts(10001, [
    { id: 'line-a', remainingCents: 10000 },
    { id: 'line-b', remainingCents: 8000 },
    { id: 'line-c', remainingCents: 6000 }
  ]);

  assert.equal([...result.values()].reduce((sum, amount) => sum + amount, 0), 10001);
  assert.ok([...result.values()].every(amount => amount > 0));
});

test('full reversal total and payment allocations use remaining original payments', () => {
  assert.match(app, /const fullTotal=capacity\.payments\.reduce\(\(sum,payment\)=>sum\+Number\(payment\.remainingCents\|\|0\),0\)/);
  assert.match(app, /const amount=Math\.min\(left,payment\.remainingCents\)/);
  assert.match(app, /const fullAllocations=allocateRefundAmounts\(fullTotal,capacity\.lines\)/);
  assert.match(app, /const selected=available/);
  assert.match(app, /input type="checkbox" \$\{selected\?'checked':''\} disabled/);
  assert.match(app, /refundKind:'FULL_REVERSAL'/);
});
