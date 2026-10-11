/**
 * Full dashboard served as a private web app (access: MYSELF in the manifest).
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Dashboard')
    .setTitle('Commandes en attente')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Called from Dashboard.html via google.script.run. */
function getDashboardData() {
  return {
    orders: sortOrders(loadOrders()),
    labels: STATUS_LABELS,
    generatedAt: new Date().toISOString(),
  };
}
