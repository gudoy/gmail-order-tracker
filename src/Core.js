/**
 * Pure logic shared by every module: status model, order identity, merging,
 * schema.org JSON-LD parsing. No Apps Script service is used here, so this
 * file is also loaded by the Node test suite (see test/core.test.js).
 */

// Ordered from earliest to latest step of a delivery. Terminal states at the end.
const STATUSES = [
  'preorder',
  'ordered',
  'processing',
  'shipped',
  'in_transit',
  'out_for_delivery',
  'available_for_pickup',
  'issue',
  'delivered',
  'cancelled',
  'returned',
];

const STATUS_LABELS = {
  preorder: 'Précommande',
  ordered: 'Commandée',
  processing: 'En préparation',
  shipped: 'Expédiée',
  in_transit: 'En transit',
  out_for_delivery: 'En cours de livraison',
  available_for_pickup: 'Disponible en point relais',
  issue: 'Problème / retard',
  delivered: 'Livrée',
  cancelled: 'Annulée',
  returned: 'Retournée',
};

const CLOSED_STATUSES = ['delivered', 'cancelled', 'returned'];

const ORDER_FIELDS = [
  'key',
  'merchant',
  'orderNumber',
  'items',
  'price',
  'currency',
  'orderDate',
  'status',
  'carrier',
  'trackingNumber',
  'trackingUrl',
  'eta',
  'lastEvent',
  'lastEventAt',
  'messageIds',
  'threadId',
  'updatedAt',
];

// schema.org deliveryStatus / orderStatus values (URL or bare name).
const SCHEMA_STATUS_MAP = {
  OrderProcessing: 'processing',
  OrderPaymentDue: 'ordered',
  OrderPickupAvailable: 'available_for_pickup',
  OrderInTransit: 'in_transit',
  OrderDelivered: 'delivered',
  OrderCancelled: 'cancelled',
  OrderReturned: 'returned',
  OrderProblem: 'issue',
};

function normalizeStatus(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const bare = raw.replace(/^https?:\/\/schema\.org\//, '');
  if (SCHEMA_STATUS_MAP[bare]) return SCHEMA_STATUS_MAP[bare];
  const lower = bare.toLowerCase();
  return STATUSES.indexOf(lower) >= 0 ? lower : '';
}

function statusRank(status) {
  return STATUSES.indexOf(status);
}

function isOpen(order) {
  return CLOSED_STATUSES.indexOf(order.status) < 0;
}

function normalizeMerchant(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\.(com|fr|de|co\.uk|net)$/, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Stable identity of an order: merchant + order number when known,
 * otherwise the tracking number, otherwise the source message.
 */
function orderKey(order, messageId) {
  const orderNumber = String(order.orderNumber || '').replace(/\s+/g, '');
  if (orderNumber) return normalizeMerchant(order.merchant) + '#' + orderNumber;
  const tracking = String(order.trackingNumber || '').replace(/\s+/g, '');
  if (tracking) return 'trk#' + tracking;
  return 'msg#' + messageId;
}

/**
 * Merges a newly extracted order into the stored one.
 * - Non-empty incoming fields override stored ones.
 * - Status never moves backwards, except into a closed state (cancel/return)
 *   or out of 'issue' (a delay that resolves).
 */
function mergeOrder(existing, incoming) {
  const merged = Object.assign({}, existing);
  ORDER_FIELDS.forEach(function (field) {
    if (field === 'status' || field === 'messageIds') return;
    const value = incoming[field];
    if (value !== undefined && value !== null && value !== '') merged[field] = value;
  });

  const current = existing.status || '';
  const next = incoming.status || '';
  if (next && (!current || shouldReplaceStatus(current, next))) merged.status = next;

  const ids = splitIds(existing.messageIds).concat(splitIds(incoming.messageIds));
  merged.messageIds = ids.filter(function (id, i) { return ids.indexOf(id) === i; }).join(',');
  return merged;
}

function shouldReplaceStatus(current, next) {
  if (CLOSED_STATUSES.indexOf(next) >= 0) return true;
  if (current === 'issue') return true;
  if (next === 'issue') return CLOSED_STATUSES.indexOf(current) < 0;
  return statusRank(next) >= statusRank(current);
}

function splitIds(value) {
  return String(value || '').split(',').filter(Boolean);
}

/**
 * Extracts schema.org Order / ParcelDelivery data embedded by merchants
 * as <script type="application/ld+json"> in the HTML body.
 * Returns a partial order, or null when nothing usable is found.
 */
function parseJsonLd(html) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const nodes = [];
  let match;
  while ((match = re.exec(html || '')) !== null) {
    try {
      collectNodes(JSON.parse(decodeEntities(match[1].trim())), nodes);
    } catch (e) {
      // Malformed block: ignore, the LLM fallback will handle the email.
    }
  }

  const order = {};
  nodes.forEach(function (node) {
    const type = [].concat(node['@type'] || [])[0];
    if (type === 'Order') applyOrderNode(order, node);
    if (type === 'ParcelDelivery') applyParcelNode(order, node);
  });
  return order.orderNumber || order.trackingNumber ? order : null;
}

function collectNodes(value, out) {
  if (Array.isArray(value)) return value.forEach(function (v) { collectNodes(v, out); });
  if (!value || typeof value !== 'object') return;
  out.push(value);
  if (value['@graph']) collectNodes(value['@graph'], out);
}

function applyOrderNode(order, node) {
  order.orderNumber = order.orderNumber || str(node.orderNumber);
  order.merchant = order.merchant || nameOf(node.merchant) || nameOf(node.seller);
  order.orderDate = order.orderDate || str(node.orderDate).slice(0, 10);
  order.price = order.price || str(node.price || node.totalPrice);
  order.currency = order.currency || str(node.priceCurrency);
  order.status = normalizeStatus(node.orderStatus) || order.status;
  const offers = [].concat(node.acceptedOffer || []);
  const items = offers.map(function (o) { return nameOf(o.itemOffered); }).filter(Boolean);
  if (items.length) order.items = items.join(' · ');
}

function applyParcelNode(order, node) {
  order.trackingNumber = order.trackingNumber || str(node.trackingNumber);
  order.trackingUrl = order.trackingUrl || str(node.trackingUrl);
  order.carrier = order.carrier || nameOf(node.carrier) || nameOf(node.provider);
  order.eta = order.eta || str(node.expectedArrivalUntil || node.expectedArrivalFrom).slice(0, 10);
  order.status = normalizeStatus(node.deliveryStatus) || order.status || 'shipped';
  if (node.partOfOrder) applyOrderNode(order, node.partOfOrder);
  const items = [].concat(node.itemShipped || []).map(nameOf).filter(Boolean);
  if (items.length && !order.items) order.items = items.join(' · ');
}

function nameOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return str(value.name);
}

function str(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function decodeEntities(text) {
  return text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Sorts open orders first, by ETA (unknown last), then by order date desc. */
function sortOrders(orders) {
  return orders.slice().sort(function (a, b) {
    const openDiff = Number(!isOpen(a)) - Number(!isOpen(b));
    if (openDiff) return openDiff;
    const etaA = a.eta || '9999';
    const etaB = b.eta || '9999';
    if (etaA !== etaB) return etaA < etaB ? -1 : 1;
    return String(b.orderDate || '').localeCompare(String(a.orderDate || ''));
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    STATUSES,
    STATUS_LABELS,
    ORDER_FIELDS,
    normalizeStatus,
    isOpen,
    orderKey,
    mergeOrder,
    parseJsonLd,
    sortOrders,
  };
}
