import admin from "firebase-admin";

// Utilise une clé service account en JSON via env var (ou fichier local)
const sa = JSON.parse(process.env.GCP_SA_KEY_JSON);
admin.initializeApp({ credential: admin.credential.cert(sa) });

const [,, cmd, emailOrUid] = process.argv;
if (!cmd || !emailOrUid) {
  console.log("Usage: node scripts/set-admin.mjs <grant|revoke> <email|uid>");
  process.exit(1);
}

async function resolveUid(emailOrUid) {
  if (emailOrUid.includes("@")) {
    const u = await admin.auth().getUserByEmail(emailOrUid);
    return u.uid;
  }
  return emailOrUid;
}

const uid = await resolveUid(emailOrUid);

if (cmd === "grant") {
  await admin.auth().setCustomUserClaims(uid, { admin: true });
  console.log("✅ admin granted to", uid);
} else if (cmd === "revoke") {
  await admin.auth().setCustomUserClaims(uid, { admin: false });
  console.log("✅ admin revoked from", uid);
} else {
  console.log("Unknown cmd. Use grant or revoke.");
  process.exit(1);
}