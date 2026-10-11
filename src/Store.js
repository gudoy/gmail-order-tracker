/**
 * Google Sheet persistence. One row per order in the "orders" sheet,
 * one row per already-analysed Gmail message in the "processed" sheet.
 * Callers load once, mutate in memory, then save once per run.
 */
const ORDERS_SHEET = 'orders';
const PROCESSED_SHEET = 'processed';

function getSpreadsheet() {
  const id = getProp(PROPS.SPREADSHEET_ID);
  if (!id) throw new Error('Spreadsheet missing: run setup() once from the Apps Script editor.');
  return SpreadsheetApp.openById(id);
}

function loadOrders() {
  const values = getSpreadsheet().getSheetByName(ORDERS_SHEET).getDataRange().getValues();
  const header = values[0];
  return values.slice(1).filter(function (row) { return row[0]; }).map(function (row) {
    const order = {};
    header.forEach(function (field, i) { order[field] = cellToString(row[i]); });
    return order;
  });
}

function saveOrders(orders) {
  const sheet = getSpreadsheet().getSheetByName(ORDERS_SHEET);
  const rows = orders.map(function (order) {
    return ORDER_FIELDS.map(function (field) { return order[field] === undefined ? '' : String(order[field]); });
  });
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, ORDER_FIELDS.length).clearContent();
  if (rows.length) sheet.getRange(2, 1, rows.length, ORDER_FIELDS.length).setValues(rows);
}

/**
 * Inserts or merges an extracted order. Matches an existing row by key,
 * or by tracking number (a shipping email often lacks the order number).
 */
function upsertOrder(orders, incoming, messageId) {
  const key = orderKey(incoming, messageId);
  const index = orders.findIndex(function (o) {
    return o.key === key || (incoming.trackingNumber && o.trackingNumber === incoming.trackingNumber);
  });
  const now = new Date().toISOString();
  if (index >= 0) {
    orders[index] = mergeOrder(orders[index], incoming);
    orders[index].updatedAt = now;
    return orders[index];
  }
  const created = mergeOrder({ key: key }, incoming);
  created.updatedAt = now;
  orders.push(created);
  return created;
}

function loadProcessedIds() {
  const sheet = getSpreadsheet().getSheetByName(PROCESSED_SHEET);
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return new Set();
  return new Set(sheet.getRange(1, 1, lastRow, 1).getValues().map(function (r) { return String(r[0]); }));
}

function appendProcessedIds(ids) {
  if (!ids.length) return;
  const sheet = getSpreadsheet().getSheetByName(PROCESSED_SHEET);
  sheet.getRange(sheet.getLastRow() + 1, 1, ids.length, 1).setValues(ids.map(function (id) { return [id]; }));
}

function cellToString(value) {
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return value === null || value === undefined ? '' : String(value);
}
