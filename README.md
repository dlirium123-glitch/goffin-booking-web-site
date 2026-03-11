# Goffin Booking — Site de prise de rendez-vous

Application de **demande de rendez-vous** pour clients professionnels (Gaz naturel – GN uniquement).  
Réservation de créneaux avec hold temporaire, règle des 48h et synchronisation du calendrier Outlook.

---

## Stack

- **Front** : HTML / CSS / JS (vanilla), Firebase SDK (Compat) 9.x
- **Backend** : Firebase (Hosting, Authentication, Firestore)
- **Automation** : GitHub Actions (déploiement, sync Outlook, génération de créneaux, nettoyage des holds, admin claim)

---

## Structure

```
├── public/                 # Site statique (hosting)
│   ├── index.html, index.v3.js, index.css   # Client (prise de RDV)
│   ├── admin.html, admin.v3.js, admin.css   # Interface admin
│   └── __/firebase/init.js                   # Auto-config (Firebase Hosting)
├── firebase.json            # Config Firestore + Hosting (rewrites, headers, CSP)
├── firestore.rules          # Règles de sécurité Firestore
├── firestore.indexes.json   # Index composites (vide par défaut)
├── scripts/
│   └── set-admin.mjs        # Grant/revoke custom claim admin (usage via workflow)
├── tools/
│   ├── outlook-sync/        # Sync calendrier Outlook → freeSlots/publicSlots
│   ├── slot-generator/      # Génération des freeSlots (lun–ven, 09:30–17:30, 90 min)
│   └── cleanup-holds/       # Suppression des holds expirés
└── .github/workflows/
    ├── firebase-hosting.yml # Deploy sur push main
    ├── outlook-sync.yml     # Sync Outlook (cron */30 min)
    ├── generate-slots.yml   # Génération créneaux (cron 02:15 UTC)
    ├── cleanup-holds.yml    # Nettoyage holds (cron */10 min)
    ├── set-admin-claim.yml  # Grant/revoke admin (manuel)
    └── reset-all.yml        # Reset (si présent)
```

---

## Secrets GitHub (Actions)

| Secret | Usage |
|--------|--------|
| `FIREBASE_SERVICE_ACCOUNT` | Deploy Hosting + accès Firestore (outlook-sync, slot-generator, cleanup-holds) |
| `GCP_PROJECT_ID` ou `GCP_SA_KEY_JSON` | Auth Google / set-admin-claim |
| `OUTLOOK_ICS_URL` | URL du calendrier Outlook (ICS) pour la sync |

---

## Workflows

- **Deploy** : à chaque push sur `main` → déploiement Firebase Hosting.
- **Outlook sync** : toutes les 30 min (UTC) + déclenchement manuel (Run workflow).
- **Generate slots** : tous les jours à 02:15 UTC (créneaux 8 semaines, lun–ven 09:30–17:30, 90 min).
- **Cleanup holds** : toutes les 10 min (suppression des holds expirés).
- **Set admin claim** : manuel, avec paramètres `grant`/`revoke` et email ou UID.

---

## Développement local

1. Cloner le dépôt, `npm install` à la racine (si besoin pour scripts).
2. Pour les tools : `cd tools/outlook-sync` puis `npm ci` (idem pour `slot-generator`, `cleanup-holds`).
3. Tester le site : `firebase serve` (depuis la racine) ou héberger `public/` avec un serveur statique ; la config Firebase est chargée via `/__/firebase/init.js` en production (Firebase Hosting).

---

## Règles métier (rappel)

- Réservation **au minimum 48 h** à l’avance.
- **Hold** temporaire (ex. 20 min) avant confirmation ; expiration gérée par les règles + cleanup.
- **publicSlots** : reflet “libre / bloqué” du calendrier ; écriture réservée à l’admin (sync).
- Admin : **custom claim** `admin: true` (défini via workflow Set admin claim).

---

## Points d’attention

- `syncHealth` : lecture réservée aux admins ; le client affiche “statut inconnu” si non admin (volontaire).
- Index Firestore : ajouter des index composites si de nouvelles requêtes composées sont introduites.
- Documentation détaillée et analyse multi-angles : voir `ANALYSE.md` (si présent).
## Outbox email

Le projet inclut un sender bureau base sur l'outbox Firestore.

- Workflow GitHub : `.github/workflows/send-emails.yml`
- Script Node : `tools/send-emails/send.js`
- Frequence : toutes les 5 minutes

Secrets attendus :

- `OFFICE_EMAIL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

Le sender :

- lit les documents `outbox` avec `status = pending`
- construit un email a partir de `requests`, `requestAddresses`, `requestServices`, `appointments`
- envoie via SMTP
- met `outbox.status` a `sent` ou `failed`
- met `appointments.officeEmailStatus` a `sent` ou `failed`
