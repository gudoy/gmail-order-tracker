/**
 * Periodic Gmail scan: finds purchase-related emails not analysed yet,
 * extracts orders, and stores them. Entry point for the hourly trigger.
 */
const SEARCH_QUERY = '(category:purchases OR subject:(commande OR order OR expédition OR expédiée OR expédié OR ' +
  'livraison OR colis OR shipped OR delivery OR suivi OR tracking)) -in:spam -in:trash';
const INITIAL_LOOKBACK_DAYS = 90;
const OVERLAP_SECONDS = 24 * 3600;
const MAX_THREADS = 500;

/** Trigger entry point (receives the trigger event, which is ignored). */
function scanInbox() {
  return runScan({ maxMessages: 40, maxMillis: 4.5 * 60 * 1000 });
}

function runScan(options) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { processed: 0, remaining: 0, skipped: 'another scan is running' };
  try {
    return scanLocked(options);
  } finally {
    lock.releaseLock();
  }
}

function scanLocked(options) {
  const startedAt = Date.now();
  const lastScan = Number(getProp(PROPS.LAST_SCAN)) || 0;
  const since = lastScan ? lastScan - OVERLAP_SECONDS : Math.floor(startedAt / 1000) - INITIAL_LOOKBACK_DAYS * 86400;

  const processedIds = loadProcessedIds();
  const pending = findMessages(SEARCH_QUERY + ' after:' + since, since, processedIds);
  const orders = loadOrders();
  const done = [];
  let retryLater = false;

  try {
    for (let i = 0; i < pending.length && done.length < options.maxMessages; i++) {
      if (Date.now() - startedAt > options.maxMillis) break;
      try {
        processMessage(pending[i], orders);
      } catch (e) {
        if (e instanceof RetryLaterError) { retryLater = true; break; }
        console.error('Message ' + pending[i].getId() + ' skipped: ' + e.message);
      }
      done.push(pending[i].getId());
    }
  } finally {
    saveOrders(orders);
    appendProcessedIds(done);
  }

  const remaining = pending.length - done.length;
  // Only move the window forward once everything in it has been analysed.
  if (!remaining && !retryLater) setProp(PROPS.LAST_SCAN, Math.floor(startedAt / 1000));
  return { processed: done.length, remaining: remaining };
}

function findMessages(query, since, processedIds) {
  const messages = [];
  for (let start = 0; start < MAX_THREADS; start += 100) {
    const threads = GmailApp.search(query, start, 100);
    threads.forEach(function (thread) {
      thread.getMessages().forEach(function (m) {
        if (!processedIds.has(m.getId()) && m.getDate().getTime() / 1000 >= since) messages.push(m);
      });
    });
    if (threads.length < 100) break;
  }
  // Oldest first, so a later "shipped" email updates the earlier "ordered" one.
  return messages.sort(function (a, b) { return a.getDate() - b.getDate(); });
}

/** Extracts and stores one message. Returns the stored order, or null. */
function processMessage(message, orders) {
  const extracted = extractOrder(message);
  if (!extracted) return null;
  extracted.messageIds = message.getId();
  extracted.threadId = message.getThread().getId();
  return upsertOrder(orders, extracted, message.getId());
}
