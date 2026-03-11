# Goffin Booking - Frontend

Application de prise de rendez-vous pour clients professionnels, basee sur Firebase Hosting, Auth et Firestore.

## Stack

- Front: HTML / CSS / JS vanilla + Firebase Compat 9.x
- Backend: Firebase Hosting, Authentication, Firestore
- Automation: GitHub Actions pour le deploy, la sync Outlook, la generation des slots, le cleanup des holds, l'envoi des emails bureau et le claim admin

## Structure

```text
public/
  index.html, index.v3.js, index.css
  admin.html, admin.v3.js, admin.css
  scripts/
    shared/
    app/
tools/
  outlook-sync/
  slot-generator/
  cleanup-holds/
  send-emails/
.github/workflows/
  firebase-hosting.yml
  outlook-sync.yml
  generate-slots.yml
  cleanup-holds.yml
  send-emails.yml
  set-admin-claim.yml
  reset-all.yml
```

## Secrets GitHub

- `FIREBASE_SERVICE_ACCOUNT`
- `GCP_PROJECT_ID`
- `OUTLOOK_ICS_URL`
- `OFFICE_EMAIL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

## Workflows

- Deploy Hosting: push sur `main`
- Outlook sync: toutes les 30 minutes
- Generate slots: tous les jours
- Cleanup holds: toutes les 10 minutes
- Send emails: toutes les 5 minutes
- Set admin claim: manuel

## Regles metier

- Reservation minimum 48h a l'avance
- Hold temporaire avant confirmation
- `publicSlots` pour la disponibilite publique
- `freeSlots` pour la disponibilite interne
- `outbox` pour la notification bureau

## Developpement local

1. Installer les dependances racine si necessaire.
2. Installer les dependances de chaque tool via `npm ci`.
3. Servir `public/` via Firebase Hosting local ou un serveur statique.

## Notes

- Le flow client V2 cree `requests`, `requestAddresses`, `requestServices`, `appointments`, `bookings` et `outbox`.
- L'admin V2 pilote les demandes, rendez-vous, holds et messages d'outbox.
- Les jobs Outlook et slot generator restent la base de la disponibilite.
