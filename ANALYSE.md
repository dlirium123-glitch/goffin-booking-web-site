# Analyse multi-angles — Goffin Booking

Document de synthèse : différents points de vue sur le projet (technique, produit, sécurité, maintenance, UX, risques). Aucune modification de code ; analyse uniquement.

---

## 1. Point de vue technique

**Architecture**
- Front 100 % statique (HTML/CSS/JS), pas de build step → déploiement simple, pas de dépendance à un bundler.
- Firebase Compat (v9) chargé depuis le CDN ; initialisation via `__/firebase/init.js` en prod → une seule config (Hosting).
- Données et logique métier dans Firestore ; pas de backend applicatif à maintenir.

**Cohérence**
- Règles Firestore alignées avec le flux client : `publicSlots` (lecture seule), `holds` (création avec expiration, suppression par owner ou admin), `bookings` + `requests` (création avec hold valide, 48h, etc.).
- Format de slot `YYYYMMDD_HHMM` utilisé partout (client, tools, règles) → pas de divergence.
- Batch `requests` + `bookings` + `delete(hold)` en une transaction côté client → cohérence.

**Dette / limites**
- Pas de TypeScript ni de tests automatisés ; refactors à faire à la main avec prudence.
- Duplication de helpers (dates, slotId, etc.) entre `index.v3.js` et `tools/outlook-sync/sync.js` (et possiblement slot-generator) → un module partagé réduirait les risques d’écart.
- `firestore.indexes.json` vide : OK tant que les requêtes restent simples ; à compléter si requêtes composées ajoutées.

---

## 2. Point de vue produit / métier

**Forces**
- Parcours clair : connexion → choix du créneau → confirmation ; messages sur le GN uniquement, 48h, confidentialité.
- Séparation nette client / admin ; raccourci “Aller sur /admin” pour les comptes admin.
- Politique d’annulation et cadre d’usage bien exposés (callouts bleu, orange, vert).

**Manques éventuels**
- Pas de rappel ou notification (email/SMS) après réservation ou avant le RDV ; à prévoir côté process ou outil externe.
- Pas de flux “modification de RDV” côté client (uniquement “demandes de modification” côté admin) ; à clarifier si besoin métier.
- Pas de multi-langue ; le public cible (pros belges) peut rester en français uniquement.

---

## 3. Point de vue sécurité

**Ce qui est bien en place**
- Règles Firestore détaillées : allowlists de champs, validation des types et contraintes (48h, hold valide, slot libre).
- Admin par custom claim uniquement (pas de liste d’emails en dur dans les règles).
- Headers HTTP (CSP, X-Frame-Options, etc.) et `firebase.json` cohérents avec une politique stricte.
- Admin en `noindex,nofollow` ; pas d’exposition inutile.

**Vigilance**
- CSP avec `script-src 'unsafe-inline'` : souvent nécessaire avec du JS inline ou des event handlers ; si tout passe en externe, on peut viser à réduire l’inline plus tard.
- Les holds sont lisibles par tous (`allow read: if true`) pour permettre les transactions ; les données sensibles restent limitées (uid, timestamps). À garder en tête si tu ajoutes des infos sensibles dans `holds`.
- Secrets : `FIREBASE_SERVICE_ACCOUNT` et `GCP_SA_KEY_JSON` doivent rester dans GitHub Secrets ; pas de commit de clés.

---

## 4. Point de vue maintenance / opérations

**Automatisation**
- Déploiement sur push `main`, sync Outlook toutes les 30 min, génération de créneaux quotidienne, cleanup des holds toutes les 10 min → peu d’actions manuelles récurrentes.
- Set-admin en workflow dispatch avec paramètres → pas besoin d’accès GCP pour donner/retirer l’admin.

**Risques opérationnels**
- Dépendance à GitHub Actions et à la disponibilité du repo ; si le repo est indisponible ou désactivé, plus de sync ni de cleanup (sauf relance manuelle ailleurs).
- Outlook : si `OUTLOOK_ICS_URL` change ou expire, la sync échoue ; les logs et le workflow Summary aident au diagnostic.
- Aucun monitoring intégré (alertes si sync en échec répété) ; à ajouter si le volume ou la criticité augmente.

**Documentation**
- README + ANALYSE.md donnent le contexte ; scripts dans `tools/` pourraient avoir un petit README chacun (entrées/sorties, variables d’env) pour faciliter la maintenabilité.

---

## 5. Point de vue UX / accessibilité

**Positif**
- Étapes numérotées (1/3, 2/3, 3/3), libellés en français, états de statut (pill, ok/warn/err).
- Boutons désactivés quand aucune sélection (ex. “Envoyer la demande”) → moins de clics inutiles.
- Message d’erreur dédié pour le chargement du calendrier et pour la réservation.

**À améliorer (sans rien casser)**
- Pas d’attributs ARIA explicites sur les zones dynamiques (calendrier, liste de créneaux) ; ajouter des `aria-live` ou rôles pourrait aider les lecteurs d’écran.
- Pas de focus management après action (ex. après envoi de la demande) ; optionnel mais confortable.
- Contraste et tailles de police : à valider avec un outil type Lighthouse / axe si tu vises une conformité stricte.

---

## 6. Point de vue coûts / scalabilité

**Firebase**
- Firestore : lecture/écriture proportionnelles au trafic ; avec peu d’utilisateurs et des crons raisonnables (sync 30 min, cleanup 10 min), les coûts restent faibles.
- Hosting : bande passante et stockage généralement modestes pour un site de ce type.

**Limites éventuelles**
- Si le nombre de créneaux (publicSlots) ou de requêtes client explose, les requêtes “toute la semaine” pourraient devenir coûteuses ; pagination ou fenêtre plus courte (ex. 1 semaine stricte) sont des leviers.
- Les workflows GitHub ont des quotas (minutes gratuites par repo) ; avec 4 crons (outlook, slots, cleanup, deploy), rester dans la gratuité est réaliste pour un usage modéré.

---

## 7. Point de vue risques fonctionnels

- **Double réservation** : limitée par les règles (slot libre, hold unique par slot, transaction batch) ; risque résiduel si deux onglets/ deux utilisateurs exactement en même temps (Firestore rejette l’un des deux).
- **Hold expiré pendant la confirmation** : le client a 20 min ; si l’utilisateur tarde, la règle `hasValidHold` échoue et le message d’erreur s’affiche → comportement attendu.
- **Décalage Outlook / publicSlots** : fenêtre de 30 min entre deux syncs ; un créneau peut être pris dans Outlook après la dernière sync et encore affiché “libre” → risque connu des systèmes à sync périodique ; à documenter côté métier (ou réduire l’intervalle si critique).

---

## 8. Synthèse

| Angle        | Verdict court |
|-------------|----------------|
| Technique   | Solide, cohérent avec Firebase et les règles ; peu de dette visible, duplication de helpers à surveiller. |
| Produit     | Parcours clair, public cible et règles métier bien communiqués ; notifications et modifications à préciser si besoin. |
| Sécurité    | Bon niveau (règles, custom claim, headers) ; CSP avec `unsafe-inline` et lecture publique des holds à garder en tête. |
| Maintenance | Bien automatisé ; dépendance GitHub/Outlook et absence de monitoring à considérer si l’usage grandit. |
| UX          | Lisible et guidé ; marge de progrès en accessibilité et gestion du focus. |
| Coûts       | Adapté à un usage petit/moyen ; garder un œil sur les lectures Firestore si le trafic augmente. |
| Risques     | Double réservation et décalage sync acceptables si documentés ; comportement hold expiré correct. |

---

*Document généré à titre d’analyse ; aucun changement de code appliqué.*
