/**
 * One-time setup, run manually from the Apps Script editor:
 * creates the data spreadsheet and the time-driven triggers.
 */
const TRIGGERS = [
  { fn: 'scanInbox', hours: 1 },
  { fn: 'refreshTracking', hours: 2 },
];

function setup() {
  ensureSpreadsheet();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (TRIGGERS.some(function (d) { return d.fn === t.getHandlerFunction(); })) ScriptApp.deleteTrigger(t);
  });
  TRIGGERS.forEach(function (d) { ScriptApp.newTrigger(d.fn).timeBased().everyHours(d.hours).create(); });
  checkConfig();
}

function ensureSpreadsheet() {
  if (getProp(PROPS.SPREADSHEET_ID)) return;
  const spreadsheet = SpreadsheetApp.create('Commandes en attente — données');
  const orders = spreadsheet.getSheets()[0].setName(ORDERS_SHEET);
  // Plain text everywhere: stops Sheets from turning dates and numbers into typed cells.
  orders.getRange(1, 1, orders.getMaxRows(), ORDER_FIELDS.length).setNumberFormat('@');
  orders.getRange(1, 1, 1, ORDER_FIELDS.length).setValues([ORDER_FIELDS]).setFontWeight('bold');
  orders.setFrozenRows(1);
  spreadsheet.insertSheet(PROCESSED_SHEET).getRange('A:A').setNumberFormat('@');
  setProp(PROPS.SPREADSHEET_ID, spreadsheet.getId());
  console.log('Spreadsheet created: ' + spreadsheet.getUrl());
}

/** Logs which settings are present, never their values. */
function checkConfig() {
  console.log('ANTHROPIC_API_KEY: ' + (getProp(PROPS.ANTHROPIC_API_KEY) ? 'set' : 'MISSING (required)'));
  console.log('TRACK17_API_KEY: ' + (getProp(PROPS.TRACK17_API_KEY) ? 'set' : 'not set (live tracking disabled)'));
  console.log('CLAUDE_MODEL: ' + (getProp(PROPS.CLAUDE_MODEL) || DEFAULT_CLAUDE_MODEL));
  console.log('Dashboard URL: ' + (ScriptApp.getService().getUrl() || 'not deployed as web app yet'));
}

/** Forgets the scan history so the next scan re-reads the last 90 days. Orders are kept. */
function resetScan() {
  PropertiesService.getScriptProperties().deleteProperty(PROPS.LAST_SCAN);
  getSpreadsheet().getSheetByName(PROCESSED_SHEET).clearContents();
}
