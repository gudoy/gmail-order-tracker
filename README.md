# Gmail Order Tracker — Commandes en attente

Module complémentaire Gmail (Google Apps Script) qui détecte les commandes dans vos mails et affiche en un coup d'œil toutes les commandes en attente de réception : marchand, produits, date, prix, statut, transporteur, lien de suivi, date de livraison prévue, dernier événement de suivi.

- **Panneau latéral Gmail** : liste des commandes en cours, et fiche de la commande liée au mail ouvert (ou bouton « Analyser ce mail »).
- **Tableau de bord web** privé : tableau complet, filtrable, livrées masquables.
- **Scan automatique** toutes les heures, **suivi colis** toutes les 2 heures (optionnel, via 17TRACK).

Tout tourne dans votre compte Google : pas de serveur, pas de publication sur le Marketplace.

## Comment ça marche

```
Trigger horaire ─▶ recherche Gmail (category:purchases, sujets « commande », « expédié », « colis »…)
                   └─▶ pour chaque nouveau mail :
                        1. JSON-LD schema.org (Order / ParcelDelivery) si le marchand l'intègre
                        2. sinon Claude (structured outputs) ─▶ marchand, n°, articles, prix,
                           date, statut, transporteur, n° et lien de suivi, date prévue
                   └─▶ fusion par n° de commande ou n° de suivi (un mail « expédié » met à jour
                       la commande, le statut ne recule jamais)
                   └─▶ Google Sheet (base de données)
Trigger 2 h ─────▶ 17TRACK (multi-transporteurs) ─▶ statut + dernier événement + date prévue
Panneau Gmail / tableau web ◀── lecture du Sheet
```

| Fichier | Rôle |
|---|---|
| `src/Core.js` | Logique pure : statuts, identité d'une commande, fusion, parsing JSON-LD (testée sous Node) |
| `src/Scanner.js` | Scan Gmail périodique, fenêtre glissante, reprise sur lots |
| `src/Extractor.js` | Extraction JSON-LD puis Claude |
| `src/Tracking.js` | Suivi temps réel 17TRACK |
| `src/Store.js` | Lecture / écriture du Google Sheet |
| `src/AddOn.js` | Cartes du panneau Gmail |
| `src/WebApp.js`, `src/Dashboard.html` | Tableau de bord web |
| `src/Setup.js` | Création du Sheet et des triggers |

## Installation (≈ 15 min)

Prérequis : Node.js 18+, un compte Google, une clé API Anthropic ([console.anthropic.com](https://console.anthropic.com)). Optionnel : une clé API [17TRACK](https://api.17track.net) pour le suivi en temps réel.

1. Activez l'API Apps Script pour votre compte : <https://script.google.com/home/usersettings>.
2. Clonez le dépôt puis connectez clasp :
   ```bash
   git clone https://github.com/gudoy/gmail-order-tracker.git && cd gmail-order-tracker
   npm run login
   ```
3. Créez le projet Apps Script (génère `.clasp.json`, ignoré par git) puis poussez le code :
   ```bash
   npx @google/clasp create --type standalone --title "Commandes en attente" --rootDir src
   npm run push
   ```
   Si clasp a remplacé `src/appsscript.json`, restaurez-le (`git checkout src/appsscript.json`) puis relancez `npm run push`.
4. Ouvrez l'éditeur (`npm run open`) puis **Paramètres du projet > Propriétés du script** et ajoutez :
   | Propriété | Valeur |
   |---|---|
   | `ANTHROPIC_API_KEY` | votre clé Anthropic (obligatoire) |
   | `TRACK17_API_KEY` | votre clé 17TRACK (optionnel) |
   | `CLAUDE_MODEL` | optionnel, défaut `claude-haiku-5-5` |
5. Dans l'éditeur, exécutez la fonction **`setup`** et acceptez les autorisations. Elle crée le Google Sheet et les triggers.
6. **Tableau web** : *Déployer > Nouveau déploiement > Application Web* (exécuter en tant que : moi, accès : moi uniquement).
7. **Module Gmail** : *Déployer > Tester les déploiements > Module complémentaire Google Workspace > Installer*. Rechargez Gmail : l'icône 🚚 apparaît dans le panneau de droite.
8. Optionnel : exécutez `scanInbox` une première fois pour remplir le tableau sans attendre le trigger. Le premier scan couvre les 90 derniers jours, par lots de 40 mails par heure.

## Sécurité et confidentialité

- **Aucun secret dans le dépôt.** Les clés sont uniquement dans les *Script Properties* de votre projet Apps Script. `.clasp.json` (votre scriptId) et `.clasprc.json` (tokens OAuth) sont ignorés par git.
- Le tableau web est déployé en accès **« moi uniquement »**.
- Le texte des mails candidats est envoyé à l'API Anthropic pour l'extraction (sauf quand le marchand fournit du JSON-LD complet). Le corps est limité à 40 000 caractères par mail. Le prompt traite le contenu du mail comme donnée non fiable.
- Seuls les liens `http(s)` extraits des mails sont rendus cliquables.
- Les numéros de suivi sont envoyés à 17TRACK si vous configurez cette clé.

## Coûts

- Apps Script : gratuit (quotas grand public largement suffisants).
- Claude Haiku 5.5 : de l'ordre de 0,1 centime par mail analysé.
- 17TRACK : offre gratuite limitée en nombre de colis suivis par mois.

## Fonctions utiles (éditeur Apps Script)

| Fonction | Effet |
|---|---|
| `setup` | Crée le Sheet (si absent) et (re)crée les triggers |
| `scanInbox` | Lance un scan maintenant |
| `refreshTracking` | Rafraîchit le suivi des colis maintenant |
| `checkConfig` | Affiche quelles propriétés sont définies (sans les valeurs) |
| `resetScan` | Oublie l'historique de scan : le prochain scan relit 90 jours (les commandes sont conservées) |

## Développement

```bash
npm test   # tests de la logique pure (src/Core.js) avec node:test
npm run push
```

## Licence

MIT
