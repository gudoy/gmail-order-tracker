/**
 * Live parcel status through the 17TRACK API (multi-carrier, auto-detects
 * the carrier from the tracking number). Optional: skipped without a key.
 * Docs: https://api.17track.net/en/doc
 */
const TRACK17_URL = 'https://api.17track.net/track/v2.2/';
const TRACK17_BATCH = 40;

const TRACK17_STATUS_MAP = {
  InfoReceived: 'shipped',
  InTransit: 'in_transit',
  OutForDelivery: 'out_for_delivery',
  AvailableForPickup: 'available_for_pickup',
  Delivered: 'delivered',
  DeliveryFailure: 'issue',
  Exception: 'issue',
  Expired: 'issue',
};

/** Trigger entry point. */
function refreshTracking() {
  const apiKey = getProp(PROPS.TRACK17_API_KEY);
  if (!apiKey) return { updated: 0, skipped: 'TRACK17_API_KEY not set' };

  const orders = loadOrders();
  const tracked = orders.filter(function (o) { return isOpen(o) && o.trackingNumber; });
  let updated = 0;

  for (let i = 0; i < tracked.length; i += TRACK17_BATCH) {
    const numbers = tracked.slice(i, i + TRACK17_BATCH).map(function (o) { return { number: o.trackingNumber }; });
    // Registering an already registered number is rejected harmlessly.
    track17Call(apiKey, 'register', numbers);
    const accepted = (track17Call(apiKey, 'gettrackinfo', numbers).data || {}).accepted || [];
    accepted.forEach(function (result) {
      const order = tracked.find(function (o) { return o.trackingNumber === result.number; });
      if (order && applyTrackInfo(order, result.track_info || {})) updated++;
    });
  }

  if (updated) saveOrders(orders);
  return { updated: updated };
}

function applyTrackInfo(order, info) {
  const latestStatus = (info.latest_status || {}).status;
  const event = info.latest_event || {};
  const eta = (((info.time_metrics || {}).estimated_delivery_date) || {}).to;
  const incoming = {
    status: TRACK17_STATUS_MAP[latestStatus] || '',
    lastEvent: [event.description, event.location].filter(Boolean).join(' — '),
    lastEventAt: event.time_iso || '',
    eta: eta ? String(eta).slice(0, 10) : '',
  };
  const merged = mergeOrder(order, incoming);
  const changed = ['status', 'lastEvent', 'lastEventAt', 'eta'].some(function (f) { return merged[f] !== order[f]; });
  if (changed) {
    Object.assign(order, merged, { updatedAt: new Date().toISOString() });
  }
  return changed;
}

function track17Call(apiKey, endpoint, numbers) {
  const response = UrlFetchApp.fetch(TRACK17_URL + endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { '17token': apiKey },
    payload: JSON.stringify(numbers),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    console.error('17TRACK ' + endpoint + ' ' + response.getResponseCode() + ': ' + response.getContentText().slice(0, 300));
    return {};
  }
  return JSON.parse(response.getContentText());
}
