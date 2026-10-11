const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/Core.js');

test('orderKey prefers merchant + order number, then tracking, then message', () => {
  assert.equal(core.orderKey({ merchant: 'Fnac.com', orderNumber: '12 34' }, 'm1'), 'fnac#1234');
  assert.equal(core.orderKey({ trackingNumber: '6A123' }, 'm1'), 'trk#6A123');
  assert.equal(core.orderKey({}, 'm1'), 'msg#m1');
});

test('mergeOrder keeps stored values when incoming fields are empty', () => {
  const merged = core.mergeOrder(
    { merchant: 'Fnac', price: '49.90', status: 'ordered', messageIds: 'a' },
    { merchant: '', trackingNumber: 'X1', status: 'shipped', messageIds: 'b' }
  );
  assert.equal(merged.price, '49.90');
  assert.equal(merged.trackingNumber, 'X1');
  assert.equal(merged.status, 'shipped');
  assert.equal(merged.messageIds, 'a,b');
});

test('mergeOrder never moves status backwards', () => {
  const merged = core.mergeOrder({ status: 'in_transit' }, { status: 'ordered' });
  assert.equal(merged.status, 'in_transit');
});

test('mergeOrder accepts cancellation and recovery from issue', () => {
  assert.equal(core.mergeOrder({ status: 'shipped' }, { status: 'cancelled' }).status, 'cancelled');
  assert.equal(core.mergeOrder({ status: 'issue' }, { status: 'in_transit' }).status, 'in_transit');
  assert.equal(core.mergeOrder({ status: 'delivered' }, { status: 'issue' }).status, 'delivered');
});

test('mergeOrder deduplicates message ids', () => {
  assert.equal(core.mergeOrder({ messageIds: 'a,b' }, { messageIds: 'b' }).messageIds, 'a,b');
});

test('normalizeStatus maps schema.org URLs and rejects unknown values', () => {
  assert.equal(core.normalizeStatus('http://schema.org/OrderInTransit'), 'in_transit');
  assert.equal(core.normalizeStatus('delivered'), 'delivered');
  assert.equal(core.normalizeStatus('whatever'), '');
});

test('parseJsonLd reads a ParcelDelivery with its parent order', () => {
  const html = `<html><script type="application/ld+json">
    {"@context":"http://schema.org","@type":"ParcelDelivery",
     "trackingNumber":"6A12345678","trackingUrl":"https://track.example/6A12345678",
     "carrier":{"@type":"Organization","name":"Colissimo"},
     "expectedArrivalUntil":"2026-10-14T18:00:00+02:00",
     "deliveryStatus":"http://schema.org/OrderInTransit",
     "partOfOrder":{"@type":"Order","orderNumber":"A-998","merchant":{"name":"Boulanger"},
       "acceptedOffer":[{"itemOffered":{"name":"Casque audio"}}]}}
  </script></html>`;
  const order = core.parseJsonLd(html);
  assert.equal(order.trackingNumber, '6A12345678');
  assert.equal(order.carrier, 'Colissimo');
  assert.equal(order.eta, '2026-10-14');
  assert.equal(order.status, 'in_transit');
  assert.equal(order.orderNumber, 'A-998');
  assert.equal(order.merchant, 'Boulanger');
  assert.equal(order.items, 'Casque audio');
});

test('parseJsonLd ignores malformed blocks and unrelated types', () => {
  assert.equal(core.parseJsonLd('<script type="application/ld+json">{oops</script>'), null);
  assert.equal(core.parseJsonLd('<script type="application/ld+json">{"@type":"Event"}</script>'), null);
});

test('sortOrders puts open orders first, earliest ETA first', () => {
  const sorted = core.sortOrders([
    { key: 'done', status: 'delivered', eta: '2026-01-01' },
    { key: 'late', status: 'shipped', eta: '2026-10-20' },
    { key: 'unknown', status: 'ordered' },
    { key: 'soon', status: 'in_transit', eta: '2026-10-12' },
  ]);
  assert.deepEqual(sorted.map((o) => o.key), ['soon', 'late', 'unknown', 'done']);
});
