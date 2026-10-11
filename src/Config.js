/**
 * Runtime configuration. Secrets live ONLY in Script Properties
 * (Apps Script editor > Project Settings > Script Properties), never in code.
 */
const PROPS = {
  ANTHROPIC_API_KEY: 'ANTHROPIC_API_KEY', // required: email extraction
  TRACK17_API_KEY: 'TRACK17_API_KEY', // optional: live parcel tracking
  CLAUDE_MODEL: 'CLAUDE_MODEL', // optional override
  SPREADSHEET_ID: 'SPREADSHEET_ID', // written by setup()
  LAST_SCAN: 'LAST_SCAN', // epoch seconds, written by the scanner
};

const DEFAULT_CLAUDE_MODEL = 'claude-haiku-5-5';

function getProp(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || '';
}

function setProp(name, value) {
  PropertiesService.getScriptProperties().setProperty(name, String(value));
}
