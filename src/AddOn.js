/**
 * Gmail side panel (Google Workspace add-on, CardService).
 * - Homepage: open orders at a glance.
 * - Contextual: the order linked to the opened email, or a button to analyse it.
 */
const CARD_MAX_ORDERS = 25;

function onHomepage() {
  return buildHomeCard();
}

function buildHomeCard() {
  const open = sortOrders(loadOrders()).filter(isOpen);
  const list = CardService.newCardSection().setHeader(open.length + ' commande(s) en attente');
  if (!open.length) list.addWidget(CardService.newTextParagraph().setText('Aucune commande en attente.'));
  open.slice(0, CARD_MAX_ORDERS).forEach(function (o) { list.addWidget(orderWidget(o)); });

  const actions = CardService.newButtonSet().addButton(
    CardService.newTextButton().setText('Scanner maintenant')
      .setOnClickAction(CardService.newAction().setFunctionName('onScanNow'))
  );
  const dashboardUrl = ScriptApp.getService().getUrl();
  if (dashboardUrl) {
    actions.addButton(CardService.newTextButton().setText('Tableau complet')
      .setOpenLink(CardService.newOpenLink().setUrl(dashboardUrl)));
  }

  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Commandes en attente'))
    .addSection(CardService.newCardSection().addWidget(actions))
    .addSection(list)
    .build();
}

function onGmailMessage(e) {
  GmailApp.setCurrentMessageAccessToken(e.gmail.accessToken);
  const messageId = e.gmail.messageId;
  const order = loadOrders().find(function (o) { return o.messageIds.split(',').indexOf(messageId) >= 0; });
  return order ? buildOrderCard(order) : buildUnknownMessageCard(messageId);
}

function buildOrderCard(order) {
  const section = CardService.newCardSection()
    .addWidget(orderWidget(order))
    .addWidget(field('N° de commande', order.orderNumber))
    .addWidget(field('Date de commande', order.orderDate))
    .addWidget(field('Livraison prévue', order.eta))
    .addWidget(field('Transporteur', order.carrier))
    .addWidget(field('N° de suivi', order.trackingNumber))
    .addWidget(field('Dernier événement', [order.lastEventAt.slice(0, 16).replace('T', ' '), order.lastEvent].filter(Boolean).join(' — ')));
  const url = safeUrl(order.trackingUrl);
  if (url) {
    section.addWidget(CardService.newTextButton().setText('Suivre le colis')
      .setOpenLink(CardService.newOpenLink().setUrl(url)));
  }
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle(order.merchant || 'Commande'))
    .addSection(section)
    .build();
}

function buildUnknownMessageCard(messageId) {
  const section = CardService.newCardSection()
    .addWidget(CardService.newTextParagraph().setText('Aucune commande liée à ce mail.'))
    .addWidget(CardService.newTextButton().setText('Analyser ce mail').setOnClickAction(
      CardService.newAction().setFunctionName('onAnalyzeMessage').setParameters({ messageId: messageId })));
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Commandes en attente'))
    .addSection(section)
    .build();
}

function onAnalyzeMessage(e) {
  GmailApp.setCurrentMessageAccessToken(e.gmail.accessToken);
  const message = GmailApp.getMessageById(e.parameters.messageId);
  const orders = loadOrders();
  const order = processMessage(message, orders);
  saveOrders(orders);
  appendProcessedIds([message.getId()]);
  if (!order) return notify('Ce mail ne semble pas concerner une commande.');
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildOrderCard(order)))
    .build();
}

function onScanNow() {
  // Add-on actions time out after ~30 s: analyse a small batch only.
  const result = runScan({ maxMessages: 5, maxMillis: 20 * 1000 });
  const text = result.skipped
    ? 'Scan déjà en cours.'
    : result.processed + ' mail(s) analysé(s)' + (result.remaining ? ', ' + result.remaining + ' restant(s) pour le scan horaire.' : '.');
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(text))
    .setNavigation(CardService.newNavigation().updateCard(buildHomeCard()))
    .build();
}

function orderWidget(order) {
  const widget = CardService.newDecoratedText()
    .setTopLabel(escapeHtml([order.merchant, formatPrice(order)].filter(Boolean).join(' · ')))
    .setText(escapeHtml(truncate(order.items || order.orderNumber || 'Article inconnu', 120)))
    .setBottomLabel(escapeHtml([STATUS_LABELS[order.status] || 'Statut inconnu', order.eta && 'prévue ' + order.eta].filter(Boolean).join(' · ')))
    .setWrapText(true);
  const url = safeUrl(order.trackingUrl);
  if (url) widget.setOpenLink(CardService.newOpenLink().setUrl(url));
  return widget;
}

function field(label, value) {
  return CardService.newDecoratedText().setTopLabel(label).setText(escapeHtml(value || '—')).setWrapText(true);
}

function notify(text) {
  return CardService.newActionResponseBuilder().setNotification(CardService.newNotification().setText(text)).build();
}

function formatPrice(order) {
  return order.price ? order.price + ' ' + (order.currency || '') : '';
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Tracking URLs come from email content: only allow http(s). */
function safeUrl(url) {
  return /^https?:\/\//i.test(url || '') ? url : '';
}
