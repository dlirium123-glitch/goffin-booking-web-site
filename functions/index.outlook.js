const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const ical = require("node-ical");

admin.initializeApp();
const db = admin.firestore();

// ⚠️ ICS public → OK en dur pour l’instant
const OUTLOOK_ICS_URL = "COLLE_ICI_TON_URL_ICS";

exports.syncOutlookICS = functions.https.onRequest(async (req, res) => {
  try {
    const icsText = await fetch(OUTLOOK_ICS_URL).then(r => r.text());
    const events = ical.parseICS(icsText);

    const batch = db.batch();
    let count = 0;

    for (const k in events) {
      const ev = events[k];
      if (ev.type !== "VEVENT") continue;
      if (!ev.start || !ev.end) continue;

      const id = `outlook_${ev.uid || Buffer.from(k).toString("hex")}`;

      batch.set(
        db.collection("busySlots").doc(id),
        {
          start: admin.firestore.Timestamp.fromDate(ev.start),
          end: admin.firestore.Timestamp.fromDate(ev.end),
          source: "outlook",
          title: ev.summary || "",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      count++;
    }

    await batch.commit();

    res.json({ ok: true, imported: count });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});
