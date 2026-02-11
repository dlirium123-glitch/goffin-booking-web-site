// =======================================================
// Goffin Booking — index.v3.js (AUTO-GRID + 90min booking)
// Compatible freeSlots 30/60/90 min + busySlots Outlook
// =======================================================
const INDEX_VERSION = "v3-2026-02-11-auto-grid-1";
console.log("index.v3.js chargé ✅", INDEX_VERSION);

document.addEventListener("DOMContentLoaded", async () => {
  // ---------- DOM refs ----------
  const right = document.getElementById("rightPanel");
  const pill = document.getElementById("pillStatus");
  const statusText = document.getElementById("statusText");
  const btnLogout = document.getElementById("btnLogout");

  if (!right || !pill || !statusText || !btnLogout) {
    console.error("DOM manquant: rightPanel/pillStatus/statusText/btnLogout");
    return;
  }

  // ---------- CONFIG ----------
  const CFG = {
    daysToShow: 5,                 // Lun -> Ven
    // Valeurs fallback si on ne détecte rien (semaine vide)
    startMinutesFallback: 9 * 60 + 30,  // 09:30
    endMinutesFallback: 17 * 60 + 30,   // 17:30
    gridStepFallback: 30,               // affichage fallback
    bookingMinutes: 90,                 // durée totale "réservable"
    appointmentMinutes: 60,
    weeksToShowLabel: "Semaine",
  };

  // ---------- Helpers ----------
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setStatus(isLogged) {
    if (isLogged) {
      pill.classList.add("ok");
      statusText.textContent = "Connecté";
      btnLogout.style.display = "";
    } else {
      pill.classList.remove("ok");
      statusText.textContent = "Non connecté";
      btnLogout.style.display = "none";
    }
  }

  function showBanner(type, text) {
    const el = document.getElementById("uiBanner");
    if (!el) return;
    el.className = type === "ok" ? "ok" : type === "warn" ? "warn" : "alert";
    el.style.display = "block";
    el.textContent = text;
  }

  function hideBanner() {
    const el = document.getElementById("uiBanner");
    if (!el) return;
    el.style.display = "none";
    el.textContent = "";
  }

  async function waitForFirebase(maxMs = 10000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      if (window.firebase && window.firebase.auth && window.firebase.firestore) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }

  function mmToHHMM(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function startOfWeekMonday(d) {
    const x = startOfDay(d);
    const day = x.getDay(); // 0=Sun..6=Sat
    const diff = (day === 0 ? -6 : 1 - day);
    x.setDate(x.getDate() + diff);
    return x;
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function addMinutesDate(d, mins) {
    return new Date(d.getTime() + mins * 60 * 1000);
  }

  function dateKey(d) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${da}`;
  }

  function dayLabel(d) {
    const names = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
    return `${names[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function isProbablyAdblockNetworkError(err) {
    const msg = String(err?.message || "");
    return msg.includes("ERR_BLOCKED_BY_CLIENT") || msg.includes("blocked by client");
  }

  function makeWeekDays(weekStart) {
    return Array.from({ length: CFG.daysToShow }, (_, i) => addDays(weekStart, i));
  }

  function keyFromDate(d) {
    return `${dateKey(d)}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function minutesOfDay(d) {
    return d.getHours() * 60 + d.getMinutes();
  }

  // ---------- UI: Auth ----------
  function showPanel(panelId) {
    ["panelLogin", "panelSignup"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = (id === panelId) ? "block" : "none";
    });
    hideBanner();
  }

  function renderAuth(extraWarningHtml = "") {
    right.innerHTML = `
      <div class="stepWrap">
        <span class="step">Étape 1/3 — Connexion</span>
        <span class="muted" style="font-size:12px">Espace client</span>
      </div>

      ${extraWarningHtml}

      <p class="muted">Choisissez une action :</p>

      <div class="actionBox">
        <button class="btn primary" id="openLogin" type="button">Se connecter</button>
        <button class="btn alt" id="openSignup" type="button">Créer un compte</button>
      </div>

      <div class="panel" id="panelLogin">
        <h3 style="margin:0 0 6px">Se connecter</h3>
        <p class="muted" style="margin:0 0 10px">Connectez-vous avec votre e-mail et votre mot de passe.</p>

        <label class="label">Adresse e-mail</label>
        <input id="loginEmail" type="email" placeholder="ex: contact@votre-societe.be" autocomplete="email"/>

        <label class="label">Mot de passe</label>
        <input id="loginPass" type="password" placeholder="Votre mot de passe" autocomplete="current-password"/>

        <button id="btnLogin" class="btn primary" style="margin-top:12px" type="button">Me connecter</button>

        <div class="linkRow">
          <button id="btnForgot" class="linkBtn" type="button">Mot de passe oublié ?</button>
        </div>

        <p class="help">Pas encore de compte ? Cliquez sur “Créer un compte”.</p>
      </div>

      <div class="panel" id="panelSignup">
        <h3 style="margin:0 0 6px">Créer un compte</h3>
        <p class="muted" style="margin:0 0 10px">
          Créez un compte client. Vous resterez connecté sur cet appareil (sauf déconnexion).
        </p>

        <label class="label">Adresse e-mail</label>
        <input id="signupEmail" type="email" placeholder="ex: test01@check.be" autocomplete="email"/>

        <label class="label">Mot de passe</label>
        <input id="signupPass" type="password" placeholder="minimum 6 caractères" autocomplete="new-password"/>

        <button id="btnSignup" class="btn alt" style="margin-top:12px" type="button">Créer mon compte</button>
        <p class="help">Astuce test: utilisez test01@check.be + mot de passe (≥ 6 caractères).</p>
      </div>

      <div id="uiBanner" class="alert" style="display:none"></div>
    `;

    document.getElementById("openLogin")?.addEventListener("click", () => showPanel("panelLogin"));
    document.getElementById("openSignup")?.addEventListener("click", () => showPanel("panelSignup"));
    showPanel("none");
  }

  function wireAuthHandlers(auth) {
    const btnLogin = document.getElementById("btnLogin");
    const btnSignup = document.getElementById("btnSignup");
    const btnForgot = document.getElementById("btnForgot");

    if (btnLogin) {
      btnLogin.addEventListener("click", async () => {
        hideBanner();
        const email = (document.getElementById("loginEmail")?.value || "").trim().toLowerCase();
        const pass = (document.getElementById("loginPass")?.value || "").trim();

        if (!email || !pass) {
          showBanner("alert", "Veuillez renseigner votre e-mail et votre mot de passe.");
          return;
        }

        try {
          btnLogin.disabled = true;
          await auth.signInWithEmailAndPassword(email, pass);
        } catch (err) {
          console.error(err);
          if (err.code === "auth/user-not-found") {
            showBanner("alert", "Aucun compte n’existe pour cet e-mail. Veuillez créer un compte.");
          } else if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
            showBanner("alert", "Mot de passe incorrect. Veuillez réessayer.");
          } else {
            showBanner("alert", "Connexion impossible. Veuillez réessayer.");
          }
        } finally {
          btnLogin.disabled = false;
        }
      });
    }

    if (btnForgot) {
      btnForgot.addEventListener("click", async () => {
        hideBanner();
        const email = (document.getElementById("loginEmail")?.value || "").trim().toLowerCase();
        if (!email) {
          showBanner("alert", "Veuillez d’abord saisir votre adresse e-mail.");
          return;
        }
        try {
          btnForgot.disabled = true;
          await auth.sendPasswordResetEmail(email);
          showBanner("ok", "E-mail envoyé ✅ Vérifiez votre boîte mail et vos indésirables.");
        } catch (err) {
          console.error(err);
          showBanner("ok", "Si un compte existe pour cet e-mail, un message de réinitialisation a été envoyé ✅");
        } finally {
          btnForgot.disabled = false;
        }
      });
    }

    if (btnSignup) {
      btnSignup.addEventListener("click", async () => {
        hideBanner();
        const email = (document.getElementById("signupEmail")?.value || "").trim().toLowerCase();
        const pass = (document.getElementById("signupPass")?.value || "").trim();

        if (!email || !pass) {
          showBanner("alert", "Veuillez renseigner votre e-mail et choisir un mot de passe.");
          return;
        }
        if (pass.length < 6) {
          showBanner("alert", "Mot de passe : minimum 6 caractères.");
          return;
        }

        try {
          btnSignup.disabled = true;
          await auth.createUserWithEmailAndPassword(email, pass);
        } catch (err) {
          console.error(err);
          if (err.code === "auth/email-already-in-use") {
            showBanner("alert", "Cet e-mail est déjà enregistré. Veuillez vous connecter.");
          } else if (err.code === "auth/invalid-email") {
            showBanner("alert", "Adresse e-mail invalide.");
          } else {
            showBanner("alert", "Création du compte impossible. Veuillez réessayer.");
          }
        } finally {
          btnSignup.disabled = false;
        }
      });
    }
  }

  // ---------- Admin detection + redirect (safe) ----------
  let __adminChecked = false;
  let __isAdminCached = false;

  async function isAdminUser(db, user) {
    if (__adminChecked) return __isAdminCached;
    __adminChecked = true;
    try {
      const snap = await db.collection("admins").doc(user.uid).get();
      __isAdminCached = snap.exists;
      return __isAdminCached;
    } catch (e) {
      console.error("isAdminUser error:", e);
      __isAdminCached = false;
      return false;
    }
  }

  async function redirectIfAdmin(db, user) {
    const admin = await isAdminUser(db, user);
    if (!admin) return false;

    const path = window.location.pathname || "";
    if (path.startsWith("/admin")) return true;

    right.innerHTML = `
      <div class="stepWrap">
        <span class="step">Admin</span>
        <span class="muted" style="font-size:12px">${escapeHtml(user.email || "")}</span>
      </div>
      <div class="ok" style="display:block">Compte administrateur détecté ✅ Redirection vers le panneau admin…</div>
    `;
    setTimeout(() => { window.location.href = "/admin"; }, 250);
    return true;
  }

  // ---------- UI: Profile ----------
  function renderProfileForm(userEmail) {
    right.innerHTML = `
      <div class="stepWrap">
        <span class="step">Étape 2/3 — Profil client</span>
        <span class="muted" style="font-size:12px">${escapeHtml(userEmail || "")}</span>
      </div>

      <p class="muted">Complétez vos informations société (1 minute).</p>

      <label class="label">Société</label>
      <input id="p_company" placeholder="Nom de la société"/>

      <div class="row">
        <div>
          <label class="label">N° d’entreprise (BCE)</label>
          <input id="p_vat" placeholder="ex: BE0123456789"/>
        </div>
        <div>
          <label class="label">Téléphone</label>
          <input id="p_phone" placeholder="ex: +32 ..."/>
        </div>
      </div>

      <label class="label">Adresse du siège social (obligatoire)</label>
      <textarea id="p_hq" placeholder="Rue, n°, code postal, ville"></textarea>

      <label class="label">Adresse du chantier / site (si différente)</label>
      <textarea id="p_site" placeholder="Rue, n°, code postal, ville"></textarea>

      <button id="btnSaveProfile" class="btn primary" style="margin-top:12px" type="button">Enregistrer mon profil</button>

      <div id="uiBanner" class="alert" style="display:none"></div>
    `;
  }

  function validateProfile(data) {
    const errors = [];
    if (!data.company || data.company.length < 2) errors.push("Veuillez indiquer la société.");
    if (!data.vat || data.vat.length < 6) errors.push("Veuillez indiquer le numéro BCE (ex: BE...).");
    if (!data.phone || data.phone.length < 6) errors.push("Veuillez indiquer un numéro de téléphone.");
    if (!data.hqAddress || data.hqAddress.length < 8) errors.push("Veuillez indiquer l’adresse du siège social.");
    return errors;
  }

  // ---------- UI: Calendar / Booking ----------
  function renderBookingShell(userEmail) {
    right.innerHTML = `
      <div class="stepWrap">
        <span class="step">Étape 3/3 — Demande de rendez-vous</span>
        <span class="muted" style="font-size:12px">${escapeHtml(userEmail || "")}</span>
      </div>

      <div class="callout green">
        <strong>Profil OK ✅</strong>
        <div class="muted">Choisissez un créneau disponible (semaine uniquement).</div>
      </div>

      <div class="calHeader">
        <div>
          <div class="calTitle" id="calTitle">${CFG.weeksToShowLabel}</div>
          <div class="tiny" id="calSub">Chargement…</div>
        </div>
        <div class="calNav">
          <button class="calBtn" id="calPrev" type="button">◀</button>
          <button class="calBtn" id="calToday" type="button">Aujourd’hui</button>
          <button class="calBtn" id="calNext" type="button">▶</button>
        </div>
      </div>

      <div class="calLegend">
        <span class="dotKey"><span class="kdot kfree"></span> libre</span>
        <span class="dotKey"><span class="kdot kblocked"></span> indisponible</span>
        <span class="dotKey"><span class="kdot kselected"></span> sélection</span>
      </div>

      <div class="calGrid" id="calGrid"></div>

      <div class="divider"></div>

      <label class="label">Note (optionnel)</label>
      <textarea id="apptNote" placeholder="Détails utiles (type de contrôle, accès, etc.)"></textarea>

      <button id="btnBook" class="btn primary" type="button" disabled>Envoyer la demande (réservation)</button>

      <div id="uiBanner" class="alert" style="display:none"></div>

      <div class="divider"></div>
      <h3 style="margin:0 0 8px">Mes demandes</h3>
      <div class="apptList" id="apptList"></div>
    `;
  }

  function renderCalendarGrid(days, timeRows, slotStateByKey) {
    const grid = document.getElementById("calGrid");
    if (!grid) return;

    const headRow = `
      <div class="calRow">
        <div class="calCell timeCell"></div>
        ${days.map((d) => `<div class="calCell dayHead">${escapeHtml(dayLabel(d))}</div>`).join("")}
      </div>
    `;

    const rowsHtml = timeRows.map((mins) => {
      const timeCell = `<div class="calCell timeCell">${escapeHtml(mmToHHMM(mins))}</div>`;

      const dayCells = days.map((d) => {
        const slotStart = new Date(d);
        slotStart.setHours(0, 0, 0, 0);
        slotStart.setMinutes(mins);

        const key = keyFromDate(slotStart);
        const st = slotStateByKey.get(key) || { status: "blocked", disabled: true, title: "" };

        const classes = ["calCell", "slot"];
        if (st.disabled) classes.push("disabled");
        if (st.status === "blocked") classes.push("blocked");
        if (st.status === "selected") classes.push("selected");

        return `
          <div class="${classes.join(" ")}" data-slotkey="${escapeHtml(key)}" title="${escapeHtml(st.title || "")}">
            ${st.label || ""}
          </div>
        `;
      }).join("");

      return `<div class="calRow">${timeCell}${dayCells}</div>`;
    }).join("");

    grid.innerHTML = headRow + rowsHtml;
  }

  // ---------- Firestore ops ----------
  async function fetchFreeSlotsForWeek(db, weekStart) {
    const weekEnd = addDays(weekStart, 7);
    const tsStart = firebase.firestore.Timestamp.fromDate(weekStart);
    const tsEnd = firebase.firestore.Timestamp.fromDate(weekEnd);

    const snap = await db.collection("freeSlots")
      .where("start", ">=", tsStart)
      .where("start", "<", tsEnd)
      .get();

    const map = new Map(); // key => { id, ...data, __startDate }
    const list = [];
    snap.forEach((doc) => {
      const d = doc.data() || {};
      const start = d.start?.toDate?.() ? d.start.toDate() : null;
      const end = d.end?.toDate?.() ? d.end.toDate() : null;
      if (!start) return;

      const key = keyFromDate(start);
      const item = { id: doc.id, ...d, __startDate: start, __endDate: end };
      map.set(key, item);
      list.push(item);
    });

    // tri utile pour détection du pas
    list.sort((a, b) => (a.__startDate?.getTime?.() || 0) - (b.__startDate?.getTime?.() || 0));
    return { map, list };
  }

  async function fetchBusySlotsForWeek(db, weekStart) {
    const weekEnd = addDays(weekStart, 7);
    const tsStart = firebase.firestore.Timestamp.fromDate(weekStart);
    const tsEnd = firebase.firestore.Timestamp.fromDate(weekEnd);

    const snap = await db.collection("busySlots")
      .where("start", ">=", tsStart)
      .where("start", "<", tsEnd)
      .get();

    const map = new Map(); // key => { id, ...data, __startDate, __endDate }
    const list = [];
    snap.forEach((doc) => {
      const d = doc.data() || {};
      const start = d.start?.toDate?.() ? d.start.toDate() : null;
      const end = d.end?.toDate?.() ? d.end.toDate() : null;
      if (!start) return;

      const key = keyFromDate(start);
      const item = { id: doc.id, ...d, __startDate: start, __endDate: end };
      map.set(key, item);
      list.push(item);
    });

    list.sort((a, b) => (a.__startDate?.getTime?.() || 0) - (b.__startDate?.getTime?.() || 0));
    return { map, list };
  }

  async function fetchMyAppointments(db, uid) {
    const snap = await db.collection("appointments")
      .where("uid", "==", uid)
      .orderBy("start", "desc")
      .limit(10)
      .get();

    const items = [];
    snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
    return items;
  }

  function renderAppointments(list) {
    const el = document.getElementById("apptList");
    if (!el) return;

    if (!list.length) {
      el.innerHTML = `<div class="muted">Aucune demande pour l’instant.</div>`;
      return;
    }

    el.innerHTML = list.map((a) => {
      const st = a.status || "pending";
      const badgeClass =
        st === "pending" ? "pending" :
        st === "validated" ? "validated" :
        st === "refused" ? "refused" :
        st === "cancelled" ? "cancelled" : "";

      const start = a.start?.toDate?.() ? a.start.toDate() : null;
      const when = start
        ? `${dayLabel(start)} • ${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`
        : "(date inconnue)";

      return `
        <div class="apptCard">
          <div class="apptTop">
            <div>
              <div style="font-weight:900">${escapeHtml(when)}</div>
              <div class="muted" style="margin-top:4px">${escapeHtml(a.note || "")}</div>
            </div>
            <div class="badge ${badgeClass}">${escapeHtml(st)}</div>
          </div>
        </div>
      `;
    }).join("");
  }

  // ---------- AUTO GRID MODEL (from freeSlots list) ----------
  function computeGridModelFromFreeSlots(freeList) {
    // fallback
    let step = CFG.gridStepFallback;
    let dayStart = CFG.startMinutesFallback;
    let dayEnd = CFG.endMinutesFallback;

    if (!freeList || freeList.length < 2) {
      return { step, dayStart, dayEnd };
    }

    // calc step = min positive diff between starts (minutes)
    const starts = freeList
      .map((x) => x.__startDate)
      .filter(Boolean)
      .map((d) => d.getTime())
      .sort((a, b) => a - b);

    let minDiffMin = Infinity;
    for (let i = 1; i < starts.length; i++) {
      const diffMs = starts[i] - starts[i - 1];
      if (diffMs <= 0) continue;
      const diffMin = Math.round(diffMs / 60000);
      if (diffMin > 0 && diffMin < minDiffMin) minDiffMin = diffMin;
    }
    if (Number.isFinite(minDiffMin) && minDiffMin > 0) {
      // clamp to sane values
      if (minDiffMin < 10) step = 10;
      else if (minDiffMin > 120) step = 30;
      else step = minDiffMin;
    }

    // compute visible dayStart/dayEnd from actual freeSlots bounds
    const mins = freeList
      .map((x) => x.__startDate)
      .filter(Boolean)
      .map((d) => minutesOfDay(d));
    if (mins.length) dayStart = Math.min(...mins);

    const ends = freeList
      .map((x) => x.__endDate || null)
      .filter(Boolean)
      .map((d) => minutesOfDay(d));
    if (ends.length) dayEnd = Math.max(...ends);

    return { step, dayStart, dayEnd };
  }

  function buildTimeRowsFromModel(model) {
    const res = [];
    const step = model.step || CFG.gridStepFallback;
    const dayStart = model.dayStart ?? CFG.startMinutesFallback;
    const dayEnd = model.dayEnd ?? CFG.endMinutesFallback;

    // dernier départ = end - bookingMinutes
    const lastStart = (dayEnd - CFG.bookingMinutes);
    let mins = dayStart;

    // align mins on step
    if (mins % step !== 0) mins = mins + (step - (mins % step));

    while (mins <= lastStart) {
      res.push(mins);
      mins += step;
    }
    return res;
  }

  function segmentsForBooking(startDate, stepMinutes) {
    const segs = [];
    const n = Math.ceil(CFG.bookingMinutes / stepMinutes);
    let cur = new Date(startDate);
    for (let i = 0; i < n; i++) {
      segs.push(new Date(cur));
      cur = addMinutesDate(cur, stepMinutes);
    }
    return segs;
  }

  function isBusyOverlappingWindow(busyList, startDate, endDate) {
    // Overlap test: busyStart < end && busyEnd > start
    const s = startDate.getTime();
    const e = endDate.getTime();
    for (const b of busyList) {
      const bs = b.__startDate?.getTime?.() || 0;
      const be = b.__endDate?.getTime?.() || bs;
      if (bs < e && be > s) return true;
    }
    return false;
  }

  // ---------- Booking (transaction) ----------
  async function bookSlot(db, user, selected, note) {
    // selected.freeSlotDocIds => tous les segments à bloquer
    const apptRef = db.collection("appointments").doc();
    const lockRef = db.collection("slots").doc();

    const startTs = firebase.firestore.Timestamp.fromDate(selected.startDate);
    const endTs = firebase.firestore.Timestamp.fromDate(selected.endDate);

    const freeRefs = selected.freeSlotDocIds.map((id) => db.collection("freeSlots").doc(id));

    await db.runTransaction(async (tx) => {
      // 1) check all segments are still free
      const snaps = [];
      for (const ref of freeRefs) snaps.push(await tx.get(ref));

      for (const s of snaps) {
        if (!s.exists) throw new Error("Créneau introuvable (freeSlots).");
        const d = s.data() || {};
        if (String(d.status || "").toLowerCase() !== "free") {
          throw new Error("Ce créneau n’est plus disponible.");
        }
      }

      // 2) block all segments
      for (const ref of freeRefs) {
        tx.update(ref, {
          status: "blocked",
          blockedReason: "booking",
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }

      // 3) create appointment
      tx.set(apptRef, {
        uid: user.uid,
        email: (user.email || "").toLowerCase(),
        start: startTs,
        end: endTs,
        status: "pending",
        note: note || "",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      // 4) create lock
      tx.set(lockRef, {
        uid: user.uid,
        start: startTs,
        end: endTs,
        status: "booked",
        appointmentId: apptRef.id,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
  }

  // ---------- MAIN FLOW ----------
  renderAuth();
  setStatus(false);

  const okFirebase = await waitForFirebase(10000);
  if (!okFirebase) {
    const warningHtml = `
      <div class="warn" style="display:block">
        ⚠️ Firebase n’est pas chargé. Les boutons sont visibles, mais la connexion ne fonctionnera pas.
        <div class="tiny" style="margin-top:6px">Vérifie que /__/firebase/init.js se charge bien.</div>
      </div>
    `;
    renderAuth(warningHtml);
    return;
  }

  const auth = firebase.auth();
  const db = firebase.firestore();

  try { await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch {}

  btnLogout.addEventListener("click", async () => {
    await auth.signOut();
  });

  wireAuthHandlers(auth);

  // Calendar state
  let currentWeekStart = startOfWeekMonday(new Date());
  let selectedSlot = null; // { key, startDate, endDate, freeSlotDocIds: [] }
  let lastFreeSlots = { map: new Map(), list: [] };

  async function refreshCalendarAndAppointments(user) {
    const days = makeWeekDays(currentWeekStart);

    const calTitle = document.getElementById("calTitle");
    const calSub = document.getElementById("calSub");
    if (calTitle) calTitle.textContent = `Semaine du ${days[0].toLocaleDateString()}`;
    if (calSub) calSub.textContent = `Créneaux: ${CFG.bookingMinutes} min (RDV ${CFG.appointmentMinutes} + trajet)`;

    // --- load freeSlots ---
    try {
      lastFreeSlots = await fetchFreeSlotsForWeek(db, currentWeekStart);
    } catch (e) {
      console.error(e);
      if (!isProbablyAdblockNetworkError(e)) showBanner("alert", "Impossible de charger les créneaux (réseau / rules).");
      lastFreeSlots = { map: new Map(), list: [] };
    }

    // --- load busySlots ---
    let busy = { map: new Map(), list: [] };
    try {
      busy = await fetchBusySlotsForWeek(db, currentWeekStart);
    } catch (e) {
      console.error(e);
      busy = { map: new Map(), list: [] };
    }

    // --- build grid model from data ---
    const model = computeGridModelFromFreeSlots(lastFreeSlots.list);
    const timeRows = buildTimeRowsFromModel(model);

    // --- compute states ---
    const slotStateByKey = new Map();
    const now = new Date();
    const min48 = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const step = model.step || CFG.gridStepFallback;

    for (const day of days) {
      for (const mins of timeRows) {
        const start = new Date(day);
        start.setHours(0, 0, 0, 0);
        start.setMinutes(mins);
        const key = keyFromDate(start);

        const end = addMinutesDate(start, CFG.bookingMinutes);

        // base
        let status = "blocked";
        let disabled = true;
        let title = "";
        let label = "";

        // <48h
        if (start < min48) {
          status = "blocked";
          disabled = true;
          title = "Indisponible (<48h)";
          slotStateByKey.set(key, { status, disabled, title, label });
          continue;
        }

        // busy overlap window => blocked
        if (busy?.list?.length && isBusyOverlappingWindow(busy.list, start, end)) {
          status = "blocked";
          disabled = true;
          title = "Indisponible (occupé)";
          slotStateByKey.set(key, { status, disabled, title, label });
          continue;
        }

        // can we cover 90 min with consecutive freeSlots segments?
        const segStarts = segmentsForBooking(start, step);
        const neededDocs = [];
        let ok = true;

        for (const segStart of segStarts) {
          const segKey = keyFromDate(segStart);
          const doc = lastFreeSlots.map.get(segKey);

          if (!doc) { ok = false; break; }
          const st = String(doc.status || "").toLowerCase();
          if (st !== "free") { ok = false; break; }

          // si c'est "free" mais marqué conflict/outlook par des champs annexes : on respecte status
          neededDocs.push(doc.id);
        }

        if (ok) {
          status = "free";
          disabled = false;
          title = "Disponible";
          label = "Libre";
        } else {
          status = "blocked";
          disabled = true;
          title = "Indisponible";
        }

        // selected
        if (selectedSlot && selectedSlot.key === key) {
          status = "selected";
          disabled = false;
          title = "Sélectionné";
        }

        slotStateByKey.set(key, { status, disabled, title, label, __neededDocs: neededDocs });
      }
    }

    renderCalendarGrid(days, timeRows, slotStateByKey);

    // click handlers
    document.querySelectorAll(".slot[data-slotkey]").forEach((cell) => {
      cell.addEventListener("click", async () => {
        hideBanner();
        const key = cell.getAttribute("data-slotkey");
        if (!key) return;

        // toggle off
        if (selectedSlot && selectedSlot.key === key) {
          selectedSlot = null;
          const b = document.getElementById("btnBook");
          if (b) b.disabled = true;
          await refreshCalendarAndAppointments(user);
          return;
        }

        const st = slotStateByKey.get(key);
        if (!st || st.disabled) return;

        // parse key => Date
        const [dPart, hm] = key.split("_");
        const [yy, mo, dd] = dPart.split("-").map((x) => parseInt(x, 10));
        const hh = parseInt(hm.slice(0, 2), 10);
        const mm = parseInt(hm.slice(2, 4), 10);
        const start = new Date(yy, (mo - 1), dd, hh, mm, 0, 0);
        const end = addMinutesDate(start, CFG.bookingMinutes);

        // need doc ids for all segments
        const needed = st.__neededDocs || [];
        if (!needed.length) return;

        selectedSlot = { key, startDate: start, endDate: end, freeSlotDocIds: needed };

        const b = document.getElementById("btnBook");
        if (b) b.disabled = false;
        await refreshCalendarAndAppointments(user);
      });
    });

    // appointments list
    try {
      const list = await fetchMyAppointments(db, user.uid);
      renderAppointments(list);
    } catch (e) {
      console.error(e);
    }
  }

  async function bindCalendarNav(user) {
    document.getElementById("calPrev")?.addEventListener("click", async () => {
      currentWeekStart = addDays(currentWeekStart, -7);
      selectedSlot = null;
      const b = document.getElementById("btnBook");
      if (b) b.disabled = true;
      await refreshCalendarAndAppointments(user);
    });
    document.getElementById("calNext")?.addEventListener("click", async () => {
      currentWeekStart = addDays(currentWeekStart, 7);
      selectedSlot = null;
      const b = document.getElementById("btnBook");
      if (b) b.disabled = true;
      await refreshCalendarAndAppointments(user);
    });
    document.getElementById("calToday")?.addEventListener("click", async () => {
      currentWeekStart = startOfWeekMonday(new Date());
      selectedSlot = null;
      const b = document.getElementById("btnBook");
      if (b) b.disabled = true;
      await refreshCalendarAndAppointments(user);
    });
  }

  async function bindBookButton(user) {
    document.getElementById("btnBook")?.addEventListener("click", async () => {
      hideBanner();
      const btnBook = document.getElementById("btnBook");

      if (!selectedSlot) {
        showBanner("alert", "Veuillez sélectionner un créneau.");
        return;
      }

      try {
        if (btnBook) btnBook.disabled = true;

        const note = (document.getElementById("apptNote")?.value || "").trim();
        await bookSlot(db, user, selectedSlot, note);

        showBanner("ok", "Demande envoyée ✅ (en attente de validation)");
        selectedSlot = null;

        if (btnBook) btnBook.disabled = true;
        await refreshCalendarAndAppointments(user);
      } catch (e) {
        console.error(e);
        if (isProbablyAdblockNetworkError(e)) {
          showBanner("warn", "Une extension (adblock) bloque des appels réseau, mais l’action peut quand même passer.");
        } else {
          showBanner("alert", e?.message || "Réservation impossible. Le créneau vient peut-être d’être pris.");
        }
      } finally {
        if (btnBook) btnBook.disabled = !selectedSlot;
      }
    });
  }

  async function ensureProfileThenBooking(user) {
    const didRedirect = await redirectIfAdmin(db, user);
    if (didRedirect) return;

    let snap;
    try {
      snap = await db.collection("clients").doc(user.uid).get();
    } catch (e) {
      console.error(e);
      right.innerHTML = `
        <div class="stepWrap">
          <span class="step">Erreur</span>
          <span class="muted" style="font-size:12px">Profil</span>
        </div>
        <div class="alert" style="display:block">Impossible de lire Firestore (rules / réseau).</div>
      `;
      return;
    }

    if (!snap.exists) {
      renderProfileForm(user.email || "");
      setStatus(true);

      const btn = document.getElementById("btnSaveProfile");
      btn?.addEventListener("click", async () => {
        hideBanner();

        const data = {
          email: (user.email || "").toLowerCase(),
          company: (document.getElementById("p_company")?.value || "").trim(),
          vat: (document.getElementById("p_vat")?.value || "").trim(),
          phone: (document.getElementById("p_phone")?.value || "").trim(),
          hqAddress: (document.getElementById("p_hq")?.value || "").trim(),
          siteAddress: (document.getElementById("p_site")?.value || "").trim(),
          status: "ok",
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        };

        const errs = validateProfile(data);
        if (errs.length) {
          showBanner("alert", errs[0]);
          return;
        }

        try {
          btn.disabled = true;
          await db.collection("clients").doc(user.uid).set(
            { ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          );

          renderBookingShell(user.email || "");
          selectedSlot = null;

          const b = document.getElementById("btnBook");
          if (b) b.disabled = true;

          await bindCalendarNav(user);
          await bindBookButton(user);
          await refreshCalendarAndAppointments(user);
        } catch (e) {
          console.error(e);
          if (!isProbablyAdblockNetworkError(e)) {
            showBanner("alert", "Impossible d’enregistrer le profil (rules / réseau).");
          } else {
            showBanner("warn", "Une extension (adblock) bloque certains appels, mais ça peut marcher quand même.");
          }
        } finally {
          btn.disabled = false;
        }
      });

      return;
    }

    renderBookingShell(user.email || "");
    selectedSlot = null;

    const b = document.getElementById("btnBook");
    if (b) b.disabled = true;

    await bindCalendarNav(user);
    await bindBookButton(user);
    await refreshCalendarAndAppointments(user);
  }

  // ---------- Auth state ----------
  auth.onAuthStateChanged(async (user) => {
    setStatus(!!user);

    if (!user) {
      __adminChecked = false;
      __isAdminCached = false;

      renderAuth();
      wireAuthHandlers(auth);
      return;
    }

    hideBanner();
    await ensureProfileThenBooking(user);
  });
});
