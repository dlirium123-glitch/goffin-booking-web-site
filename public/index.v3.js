/* public/index.v3.js */
/* eslint-disable no-console */
(() => {
  "use strict";

  // ------------------------------------------------------------
  // Version (affichage)
  // ------------------------------------------------------------
  const APP_VERSION = "v3-2026-02-27-PRO-clean";

  // ------------------------------------------------------------
  // DOM helpers
  // ------------------------------------------------------------
  const $ = (id) => document.getElementById(id);

  const pillStatus = $("pillStatus");
  const statusText = $("statusText");
  const btnLogout = $("btnLogout");
  const clientVersion = $("clientVersion");
  const rightPanel = $("rightPanel");

  clientVersion.textContent = APP_VERSION;

  function setStatus(kind, text) {
    // kind: "ok" | "warn" | "err" | "idle"
    pillStatus.classList.remove("ok", "warn", "err");
    if (kind === "ok") pillStatus.classList.add("ok");
    if (kind === "warn") pillStatus.classList.add("warn");
    if (kind === "err") pillStatus.classList.add("err");
    statusText.textContent = text;
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function render(html) {
    rightPanel.innerHTML = html;
  }

  // ------------------------------------------------------------
  // Time helpers
  // ------------------------------------------------------------
  function nowMs() {
    return Date.now();
  }

  // ------------------------------------------------------------
  // Firebase (Compat) bootstrap
  // ------------------------------------------------------------
  function assertFirebaseLoaded() {
    if (!window.firebase) throw new Error("Firebase SDK non chargé (firebase global manquant).");
    if (!firebase.auth) throw new Error("firebase-auth-compat non chargé.");
    if (!firebase.firestore) throw new Error("firebase-firestore-compat non chargé.");
  }

  function getApp() {
    assertFirebaseLoaded();
    // Auto-init via /__/firebase/init.js => firebase.apps[0] existe
    if (!firebase.apps || firebase.apps.length === 0) {
      firebase.initializeApp({});
    }
    return firebase.app();
  }

  function getServices() {
    getApp();
    const auth = firebase.auth();
    const db = firebase.firestore();
    db.settings({ ignoreUndefinedProperties: true });
    return { auth, db };
  }

  // ------------------------------------------------------------
  // Firestore refs (canon)
  // ------------------------------------------------------------
  function refs(db) {
    return {
      users: db.collection("users"),
      publicSlots: db.collection("publicSlots"),
      holds: db.collection("holds"),
      bookings: db.collection("bookings"),
      requests: db.collection("requests"),
    };
  }

  // ------------------------------------------------------------
  // Admin check = custom claim ONLY
  // ------------------------------------------------------------
  async function getAdminClaim(auth) {
    const u = auth.currentUser;
    if (!u) return false;
    const token = await u.getIdTokenResult(true); // force refresh
    return token?.claims?.admin === true;
  }

  // ------------------------------------------------------------
  // User profile (users/{uid})
  // ------------------------------------------------------------
  function normalizeProfile(payload) {
    return {
      email: String(payload.email || ""),
      company: String(payload.company || ""),
      vat: String(payload.vat || ""),
      phone: String(payload.phone || ""),
      hqAddress: String(payload.hqAddress || ""),
    };
  }

  async function ensureUserProfile(db, user, payload) {
    const { users } = refs(db);
    const ref = users.doc(user.uid);

    const snap = await ref.get();
    if (snap.exists) return;

    const base = normalizeProfile({ ...payload, email: payload.email || user.email || "" });

    const doc = {
      ...base,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    await ref.set(doc, { merge: false });
  }

  async function updateUserProfile(db, user, payload) {
    const { users } = refs(db);
    const ref = users.doc(user.uid);

    const base = normalizeProfile({ ...payload, email: payload.email || user.email || "" });

    const doc = {
      ...base,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    await ref.set(doc, { merge: true });
  }

  // ------------------------------------------------------------
  // Slots helpers
  // ------------------------------------------------------------
  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function addDays(d, days) {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    return x;
  }

  function isWeekend(d) {
    const dow = d.getDay();
    return dow === 0 || dow === 6;
  }

  function computeWeekRange(anchorDate) {
    const d = startOfDay(anchorDate);
    // lundi comme début
    const day = d.getDay(); // 0=dim
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    const monday = addDays(d, diffToMonday);
    const sunday = addDays(monday, 7);
    return { start: monday, end: sunday };
  }

  function enforce48hUX(ts) {
    const minMs = nowMs() + 48 * 3600 * 1000;
    return ts.toMillis() >= minMs;
  }

  // ------------------------------------------------------------
  // UI
  // ------------------------------------------------------------
  function uiAuth() {
    render(`
      <h2>Étape 1/3 — Connexion</h2>
      <p class="muted">Réservé aux professionnels (GN). Utilise ton e-mail + mot de passe.</p>

      <div class="grid2">
        <div class="cardInner">
          <h3>Se connecter</h3>
          <label>E-mail</label>
          <input id="loginEmail" type="email" placeholder="ex: pro@entreprise.be" />
          <label>Mot de passe</label>
          <input id="loginPass" type="password" placeholder="••••••••" />
          <button id="btnLogin" class="btn primary">Me connecter</button>
          <p id="loginErr" class="err"></p>
        </div>

        <div class="cardInner">
          <h3>Créer un compte</h3>
          <label>E-mail</label>
          <input id="regEmail" type="email" placeholder="ex: pro@entreprise.be" />
          <label>Mot de passe</label>
          <input id="regPass" type="password" placeholder="min 6 caractères" />

          <hr />

          <h4>Profil entreprise</h4>
          <label>Société</label>
          <input id="regCompany" type="text" placeholder="Nom société" />
          <label>TVA</label>
          <input id="regVat" type="text" placeholder="BE0xxx.xxx.xxx" />
          <label>Téléphone</label>
          <input id="regPhone" type="text" placeholder="+32 ..." />
          <label>Adresse siège</label>
          <input id="regAddr" type="text" placeholder="Rue, n°, CP, Ville" />

          <button id="btnRegister" class="btn">Créer le compte</button>
          <p id="regErr" class="err"></p>
        </div>
      </div>
    `);
  }

  function uiBookingShell() {
    render(`
      <h2>Étape 2/3 — Choix du créneau</h2>
      <div class="toolbar">
        <button id="btnPrev" class="btn secondary">← Semaine -1</button>
        <div>
          <strong id="weekTitle"></strong>
          <div class="tiny muted">Règle: pas de réservation à moins de 48h.</div>
        </div>
        <button id="btnNext" class="btn secondary">Semaine +1 →</button>
      </div>

      <div id="calendar" class="calendar"></div>

      <hr />

      <h2>Étape 3/3 — Confirmer</h2>
      <div id="selectionBox" class="cardInner">
        <p class="muted">Sélectionne un créneau “Libre”.</p>
      </div>

      <div class="actions">
        <button id="btnConfirm" class="btn primary" disabled>Envoyer la demande</button>
      </div>

      <p id="bookingErr" class="err"></p>
      <p class="tiny muted">
        Tes demandes sont visibles uniquement par toi et l’administrateur.
      </p>
    `);
  }

  function uiAdminShortcut(isAdmin) {
    const el = document.createElement("div");
    el.className = "cardInner";
    el.innerHTML = `
      <h3>Espace admin</h3>
      <p class="muted">Compte détecté ${isAdmin ? "ADMIN ✅" : "non-admin"}.</p>
      <button class="btn" ${isAdmin ? "" : "disabled"} id="btnGoAdmin">Aller sur /admin</button>
    `;
    rightPanel.prepend(el);

    const btn = $("btnGoAdmin");
    if (btn && isAdmin) btn.addEventListener("click", () => (window.location.href = "/admin"));
  }

  // ------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------
  async function loadPublicSlotsForWeek(db, weekStart, weekEnd) {
    const { publicSlots } = refs(db);
    const snap = await publicSlots
      .where("start", ">=", firebase.firestore.Timestamp.fromDate(weekStart))
      .where("start", "<", firebase.firestore.Timestamp.fromDate(weekEnd))
      .get();

    const slots = [];
    snap.forEach((doc) => {
      const data = doc.data() || {};
      slots.push({ id: doc.id, ...data });
    });

    slots.sort((a, b) => (a.start?.toMillis?.() || 0) - (b.start?.toMillis?.() || 0));
    return slots;
  }

  // ------------------------------------------------------------
  // Holds (client compat) — transaction safe
  // Rules allow ONLY: uid,start,end,expiresAt,status
  // ------------------------------------------------------------
  async function tryCreateHold(db, auth, slot) {
    const u = auth.currentUser;
    if (!u) throw new Error("Non connecté.");

    const { holds, publicSlots } = refs(db);
    const slotId = slot.id;

    const holdRef = holds.doc(slotId);
    const publicRef = publicSlots.doc(slotId);

    const expiresAt = firebase.firestore.Timestamp.fromMillis(nowMs() + 20 * 60 * 1000);

    const payload = {
      uid: u.uid,
      start: slot.start,
      end: slot.end,
      expiresAt,
      status: "hold",
    };

    await db.runTransaction(async (tx) => {
      const [holdSnap, publicSnap] = await Promise.all([tx.get(holdRef), tx.get(publicRef)]);

      if (holdSnap.exists) throw new Error("Créneau déjà verrouillé (hold existant).");
      if (!publicSnap.exists) throw new Error("Créneau inexistant (publicSlots manquant).");

      const ps = publicSnap.data() || {};
      if (String(ps.status || "").toLowerCase() !== "free") {
        throw new Error("Créneau plus libre (occupé).");
      }

      // Create hold (doc absent => tx.set ok)
      tx.set(holdRef, payload);
    });

    return payload;
  }

  // ------------------------------------------------------------
  // Confirm booking — transaction safe + delete hold
  // ------------------------------------------------------------
  async function createRequestAndBooking(db, auth, slot) {
    const u = auth.currentUser;
    if (!u) throw new Error("Non connecté.");

    const { bookings, requests, holds } = refs(db);

    const slotId = slot.id;
    const requestId = `REQ_${slotId}_${u.uid.slice(0, 6)}`;

    const bookingRef = bookings.doc(slotId);
    const requestRef = requests.doc(requestId);
    const holdRef = holds.doc(slotId);

    const bookingDoc = {
      slotId,
      uid: u.uid,
      status: "pending",
      start: slot.start,
      end: slot.end,
      requestId,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    const requestDoc = {
      requestId,
      uid: u.uid,
      status: "pending",
      start: slot.start,
      end: slot.end,
      slotIds: [slotId],
      totalSlots: 1,
      durationMinutes: Math.round((slot.end.toMillis() - slot.start.toMillis()) / 60000),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    await db.runTransaction(async (tx) => {
      const [bookingSnap, requestSnap, holdSnap] = await Promise.all([
        tx.get(bookingRef),
        tx.get(requestRef),
        tx.get(holdRef),
      ]);

      if (bookingSnap.exists) throw new Error("Créneau déjà réservé (booking existant).");
      if (requestSnap.exists) throw new Error("Demande déjà créée (request existante).");

      if (!holdSnap.exists) throw new Error("Hold introuvable (il a expiré ou a été supprimé).");
      const hold = holdSnap.data() || {};
      if (hold.uid !== u.uid) throw new Error("Hold appartient à un autre utilisateur.");
      if (hold.expiresAt?.toMillis?.() && hold.expiresAt.toMillis() < nowMs()) {
        throw new Error("Hold expiré. Re-sélectionne le créneau.");
      }

      tx.set(requestRef, requestDoc, { merge: false });
      tx.set(bookingRef, bookingDoc, { merge: false });
      tx.delete(holdRef); // ✅ libère le verrou
    });

    return { requestId };
  }

  // ------------------------------------------------------------
  // Main runtime
  // ------------------------------------------------------------
  async function boot() {
    const { auth, db } = getServices();

    setStatus("idle", "Initialisation…");

    btnLogout.addEventListener("click", async () => {
      try {
        await auth.signOut();
      } catch (e) {
        console.warn("signOut failed:", e);
      }
    });

    // Render initial auth screen
    uiAuth();

    // Wire auth UI (this view exists only when not logged)
    function wireAuthUI() {
      const btnLogin = $("btnLogin");
      const btnRegister = $("btnRegister");

      if (btnLogin) {
        btnLogin.addEventListener("click", async () => {
          const loginErr = $("loginErr");
          loginErr.textContent = "";
          try {
            await auth.signInWithEmailAndPassword($("loginEmail").value.trim(), $("loginPass").value);
          } catch (e) {
            console.error(e);
            loginErr.textContent = e?.message || String(e);
          }
        });
      }

      if (btnRegister) {
        btnRegister.addEventListener("click", async () => {
          const regErr = $("regErr");
          regErr.textContent = "";

          const payload = {
            email: $("regEmail").value.trim(),
            pass: $("regPass").value,
            company: $("regCompany").value.trim(),
            vat: $("regVat").value.trim(),
            phone: $("regPhone").value.trim(),
            hqAddress: $("regAddr").value.trim(),
          };

          try {
            const cred = await auth.createUserWithEmailAndPassword(payload.email, payload.pass);
            await ensureUserProfile(db, cred.user, payload);
          } catch (e) {
            console.error(e);
            regErr.textContent = e?.message || String(e);
          }
        });
      }
    }

    wireAuthUI();

    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        btnLogout.hidden = true;
        setStatus("warn", "Non connecté");
        uiAuth();
        wireAuthUI();
        return;
      }

      btnLogout.hidden = false;
      setStatus("ok", `Connecté: ${user.email || user.uid}`);

      // ensure minimal profile (will pass rules: strings)
      try {
        await ensureUserProfile(db, user, {
          email: user.email || "",
          company: "",
          vat: "",
          phone: "",
          hqAddress: "",
        });
      } catch (e) {
        console.warn("ensureUserProfile minimal failed:", e);
      }

      // Admin shortcut (claim)
      let isAdmin = false;
      try {
        isAdmin = await getAdminClaim(auth);
      } catch (e) {
        console.warn("Admin claim check failed:", e);
      }

      uiBookingShell();
      uiAdminShortcut(isAdmin);

      // Booking runtime state
      let weekAnchor = new Date();
      let selectedSlot = null;

      const weekTitle = $("weekTitle");
      const calendar = $("calendar");
      const selectionBox = $("selectionBox");
      const btnPrev = $("btnPrev");
      const btnNext = $("btnNext");
      const btnConfirm = $("btnConfirm");
      const bookingErr = $("bookingErr");

      function resetSelection() {
        selectedSlot = null;
        btnConfirm.disabled = true;
        selectionBox.innerHTML = `<p class="muted">Sélectionne un créneau “Libre”.</p>`;
      }

      async function refreshCalendar() {
        bookingErr.textContent = "";
        resetSelection();

        const { start, end } = computeWeekRange(weekAnchor);
        const title = `${start.toLocaleDateString()} → ${addDays(end, -1).toLocaleDateString()}`;
        weekTitle.textContent = `Semaine: ${title}`;

        calendar.innerHTML = `<p class="muted">Chargement des créneaux…</p>`;

        let slots = [];
        try {
          slots = await loadPublicSlotsForWeek(db, start, end);
        } catch (e) {
          console.error(e);
          calendar.innerHTML = `<p class="err">Erreur chargement calendrier: ${escapeHtml(e.message || String(e))}</p>`;
          return;
        }

        if (slots.length === 0) {
          calendar.innerHTML = `<p class="muted">Aucun créneau public sur cette semaine.</p>`;
          return;
        }

        // Group by day
        const byDay = new Map();
        for (const s of slots) {
          const d = s.start?.toDate?.();
          if (!d) continue;
          const key = startOfDay(d).toISOString();
          if (!byDay.has(key)) byDay.set(key, []);
          byDay.get(key).push(s);
        }

        const keys = Array.from(byDay.keys()).sort();
        let html = "";

        for (const dayKey of keys) {
          const d = new Date(dayKey);
          const dayLabel = d.toLocaleDateString(undefined, {
            weekday: "long",
            day: "2-digit",
            month: "2-digit",
          });

          html += `<div class="dayBlock ${isWeekend(d) ? "weekend" : ""}">
            <div class="dayTitle">${escapeHtml(dayLabel)}</div>
            <div class="slots">`;

          for (const s of byDay.get(dayKey)) {
            const startD = s.start.toDate();
            const endD = s.end.toDate();
            const hhmm = `${pad2(startD.getHours())}:${pad2(startD.getMinutes())} → ${pad2(endD.getHours())}:${pad2(endD.getMinutes())}`;

            const status = String(s.status || "").toLowerCase();
            const isFree = status === "free";

            html += `
              <button class="slot ${isFree ? "free" : "busy"}"
                data-slotid="${escapeHtml(s.id)}"
                ${isFree ? "" : "disabled"}
                title="${escapeHtml(status)}">
                ${escapeHtml(hhmm)} • ${isFree ? "Libre" : "Occupé"}
              </button>
            `;
          }

          html += `</div></div>`;
        }

        calendar.innerHTML = html;

        // Click handlers
        calendar.querySelectorAll("button.slot.free").forEach((btn) => {
          btn.addEventListener("click", async () => {
            bookingErr.textContent = "";

            const slotId = btn.getAttribute("data-slotid");
            const slot = slots.find((x) => x.id === slotId);
            if (!slot) return;

            if (!enforce48hUX(slot.start)) {
              bookingErr.textContent = "Ce créneau est à moins de 48h. Non réservable.";
              return;
            }

            btnConfirm.disabled = true;
            selectionBox.innerHTML = `<p class="muted">Création d’un hold…</p>`;

            try {
              const hold = await tryCreateHold(db, auth, slot);
              selectedSlot = slot;

              selectionBox.innerHTML = `
                <p><strong>Créneau sélectionné</strong></p>
                <p>${escapeHtml(slot.id)}</p>
                <p class="tiny muted">Hold jusqu’à: ${escapeHtml(hold.expiresAt.toDate().toLocaleString())}</p>
              `;

              btnConfirm.disabled = false;
            } catch (e) {
              console.error(e);
              resetSelection();
              bookingErr.textContent = e?.message || String(e);
            }
          });
        });
      }

      btnPrev.addEventListener("click", async () => {
        weekAnchor = addDays(weekAnchor, -7);
        await refreshCalendar();
      });

      btnNext.addEventListener("click", async () => {
        weekAnchor = addDays(weekAnchor, +7);
        await refreshCalendar();
      });

      btnConfirm.addEventListener("click", async () => {
        bookingErr.textContent = "";
        if (!selectedSlot) return;

        btnConfirm.disabled = true;
        selectionBox.innerHTML = `<p class="muted">Envoi de la demande…</p>`;

        try {
          const res = await createRequestAndBooking(db, auth, selectedSlot);
          selectionBox.innerHTML = `
            <p><strong>Demande envoyée ✅</strong></p>
            <p class="tiny muted">ID: ${escapeHtml(res.requestId)}</p>
          `;
        } catch (e) {
          console.error(e);
          bookingErr.textContent = e?.message || String(e);
          btnConfirm.disabled = false;
          resetSelection();
        }
      });

      await refreshCalendar();
    });
  }

  boot().catch((e) => {
    console.error(e);
    setStatus("err", "Erreur init");
    render(`<p class="err">${escapeHtml(e?.message || String(e))}</p>`);
  });
})();