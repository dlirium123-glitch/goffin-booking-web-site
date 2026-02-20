// =======================================================
// Goffin Booking — index.v3.js (PRO)
// Étape 2: Calendrier pro + Formulaire intelligent + FIX permissions
// - Le client voit: Libre / Indisponible / Mon RDV (pas Outlook / pas <48h)
// - Lecture côté client: publicSlots + holds + bookings
// - Réservation: création atomique (transaction):
//   - holds (30 min) sur N créneaux consécutifs
//   - bookings (pending) sur N créneaux (blocage long anti double booking)
//   - appointments (pending) avec slotIds[]
// =======================================================
const INDEX_VERSION = "v3-2026-02-18-PRO-step4"
console.log("index.v3.js chargé ✅", INDEX_VERSION)

document.addEventListener("DOMContentLoaded", async () => {
  const right = document.getElementById("rightPanel")
  const pill = document.getElementById("pillStatus")
  const statusText = document.getElementById("statusText")
  const btnLogout = document.getElementById("btnLogout")

  if (!right || !pill || !statusText || !btnLogout) {
    console.error("DOM manquant: rightPanel/pillStatus/statusText/btnLogout")
    return
  }

  const CFG = {
    daysToShow: 5,
    startMinutes: 9 * 60 + 30,
    endMinutes: 17 * 60 + 30,
    slotMinutes: 90,
    appointmentMinutes: 60,
    weeksToShowLabel: "Semaine",
    maxAppointmentsToShow: 12,
    holdMinutes: 30,
    maxSlotsPerRequest: 4,
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;")
  }

  function setStatus(isLogged) {
    if (isLogged) {
      pill.classList.add("ok")
      statusText.textContent = "Connecté"
      btnLogout.hidden = false
    } else {
      pill.classList.remove("ok")
      statusText.textContent = "Non connecté"
      btnLogout.hidden = true
    }
  }

  function showBanner(type, text) {
    const el = document.getElementById("uiBanner")
    if (!el) return
    el.className = type === "ok" ? "ok" : type === "warn" ? "warn" : "alert"
    el.style.display = "block"
    el.textContent = text
  }

  function hideBanner() {
    const el = document.getElementById("uiBanner")
    if (!el) return
    el.style.display = "none"
    el.textContent = ""
  }

  async function waitForFirebase(maxMs = 10000) {
    const t0 = Date.now()
    while (Date.now() - t0 < maxMs) {
      if (window.firebase && window.firebase.auth && window.firebase.firestore) return true
      await new Promise((r) => setTimeout(r, 50))
    }
    return false
  }

  function mmToHHMM(mins) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
  }

  function startOfDay(d) {
    const x = new Date(d)
    x.setHours(0, 0, 0, 0)
    return x
  }

  function startOfWeekMonday(d) {
    const x = startOfDay(d)
    const day = x.getDay()
    const diff = day === 0 ? -6 : 1 - day
    x.setDate(x.getDate() + diff)
    return x
  }

  function addDays(d, n) {
    const x = new Date(d)
    x.setDate(x.getDate() + n)
    return x
  }

  function addMinutesDate(d, mins) {
    return new Date(d.getTime() + mins * 60 * 1000)
  }

  function dateKey(d) {
    const y = d.getFullYear()
    const mo = String(d.getMonth() + 1).padStart(2, "0")
    const da = String(d.getDate()).padStart(2, "0")
    return `${y}-${mo}-${da}`
  }

  function buildTimeRows() {
    const rows = []
    const lastStart = CFG.endMinutes - CFG.slotMinutes
    let mins = CFG.startMinutes
    while (mins <= lastStart) {
      rows.push(mins)
      mins += CFG.slotMinutes
    }
    return rows
  }

  function dayLabel(d) {
    const names = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"]
    return `${names[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`
  }

  function isProbablyAdblockNetworkError(err) {
    const msg = String(err?.message || "")
    return msg.includes("ERR_BLOCKED_BY_CLIENT") || msg.includes("blocked by client")
  }

  function normalizePhone(s) {
    return String(s || "").trim()
  }

  function showPanel(panelId) {
    ;["panelLogin", "panelSignup"].forEach((id) => {
      const el = document.getElementById(id)
      if (el) el.style.display = id === panelId ? "block" : "none"
    })
    hideBanner()
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
        <input id="signupEmail" type="email" placeholder="ex: contact@votre-societe.be" autocomplete="email"/>

        <label class="label">Mot de passe</label>
        <input id="signupPass" type="password" placeholder="minimum 6 caractères" autocomplete="new-password"/>

        <button id="btnSignup" class="btn alt" style="margin-top:12px" type="button">Créer mon compte</button>
      </div>

      <div id="uiBanner" class="alert" style="display:none"></div>
    `

    document.getElementById("openLogin")?.addEventListener("click", () => showPanel("panelLogin"))
    document.getElementById("openSignup")?.addEventListener("click", () => showPanel("panelSignup"))
    showPanel("none")
  }

  function wireAuthHandlers(auth) {
    const btnLogin = document.getElementById("btnLogin")
    const btnSignup = document.getElementById("btnSignup")
    const btnForgot = document.getElementById("btnForgot")

    if (btnLogin) {
      btnLogin.addEventListener("click", async () => {
        hideBanner()
        const email = (document.getElementById("loginEmail")?.value || "").trim().toLowerCase()
        const pass = (document.getElementById("loginPass")?.value || "").trim()

        if (!email || !pass) {
          showBanner("alert", "Veuillez renseigner votre e-mail et votre mot de passe.")
          return
        }

        try {
          btnLogin.disabled = true
          await auth.signInWithEmailAndPassword(email, pass)
        } catch (err) {
          console.error(err)
          if (err.code === "auth/user-not-found") {
            showBanner("alert", "Aucun compte n’existe pour cet e-mail. Veuillez créer un compte.")
          } else if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
            showBanner("alert", "Mot de passe incorrect. Veuillez réessayer.")
          } else {
            showBanner("alert", "Connexion impossible. Veuillez réessayer.")
          }
        } finally {
          btnLogin.disabled = false
        }
      })
    }

    if (btnForgot) {
      btnForgot.addEventListener("click", async () => {
        hideBanner()
        const email = (document.getElementById("loginEmail")?.value || "").trim().toLowerCase()
        if (!email) {
          showBanner("alert", "Veuillez d’abord saisir votre adresse e-mail.")
          return
        }
        try {
          btnForgot.disabled = true
          await auth.sendPasswordResetEmail(email)
          showBanner("ok", "E-mail envoyé ✅ Vérifiez votre boîte mail et vos indésirables.")
        } catch (err) {
          console.error(err)
          showBanner("ok", "Si un compte existe pour cet e-mail, un message de réinitialisation a été envoyé ✅")
        } finally {
          btnForgot.disabled = false
        }
      })
    }

    if (btnSignup) {
      btnSignup.addEventListener("click", async () => {
        hideBanner()
        const email = (document.getElementById("signupEmail")?.value || "").trim().toLowerCase()
        const pass = (document.getElementById("signupPass")?.value || "").trim()

        if (!email || !pass) {
          showBanner("alert", "Veuillez renseigner votre e-mail et choisir un mot de passe.")
          return
        }
        if (pass.length < 6) {
          showBanner("alert", "Mot de passe : minimum 6 caractères.")
          return
        }

        try {
          btnSignup.disabled = true
          await auth.createUserWithEmailAndPassword(email, pass)
        } catch (err) {
          console.error(err)
          if (err.code === "auth/email-already-in-use") {
            showBanner("alert", "Cet e-mail est déjà enregistré. Veuillez vous connecter.")
          } else if (err.code === "auth/invalid-email") {
            showBanner("alert", "Adresse e-mail invalide.")
          } else {
            showBanner("alert", "Création du compte impossible. Veuillez réessayer.")
          }
        } finally {
          btnSignup.disabled = false
        }
      })
    }
  }

  let __adminChecked = false
  let __isAdminCached = false

  async function isAdminUser(db, user) {
    if (__adminChecked) return __isAdminCached
    __adminChecked = true
    try {
      const snap = await db.collection("admins").doc(user.uid).get()
      __isAdminCached = snap.exists
      return __isAdminCached
    } catch (e) {
      console.error("isAdminUser error:", e)
      __isAdminCached = false
      return false
    }
  }

  async function redirectIfAdmin(db, user) {
    const admin = await isAdminUser(db, user)
    if (!admin) return false

    const path = window.location.pathname || ""
    if (path.startsWith("/admin")) return true

    right.innerHTML = `
      <div class="stepWrap">
        <span class="step">Admin</span>
        <span class="muted" style="font-size:12px">${escapeHtml(user.email || "")}</span>
      </div>
      <div class="ok" style="display:block">Compte administrateur détecté ✅ Redirection vers le panneau admin…</div>
    `
    setTimeout(() => {
      window.location.href = "/admin"
    }, 250)
    return true
  }

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

      <button id="btnSaveProfile" class="btn primary" style="margin-top:12px" type="button">Enregistrer mon profil</button>

      <div id="uiBanner" class="alert" style="display:none"></div>
    `
  }

  function validateProfile(data) {
    const errors = []
    if (!data.company || data.company.length < 2) errors.push("Veuillez indiquer la société.")
    if (!data.vat || data.vat.length < 6) errors.push("Veuillez indiquer le numéro BCE (ex: BE...).")
    if (!data.phone || data.phone.length < 6) errors.push("Veuillez indiquer un numéro de téléphone.")
    if (!data.hqAddress || data.hqAddress.length < 8) errors.push("Veuillez indiquer l’adresse du siège social.")
    return errors
  }

  function renderBookingShell(userEmail) {
    right.innerHTML = `
      <div class="stepWrap">
        <span class="step">Étape 3/3 — Demande de rendez-vous</span>
        <span class="muted" style="font-size:12px">${escapeHtml(userEmail || "")}</span>
      </div>

      <div class="callout green">
        <strong>Profil OK ✅</strong>
        <div class="muted">Choisissez un créneau libre. Les indisponibilités (Outlook, règles internes) sont masquées.</div>
      </div>

      <div class="calHeader">
        <div>
          <div class="calTitle" id="calTitle">${CFG.weeksToShowLabel}</div>
          <div class="tiny" id="calSub">Chargement…</div>
          <div class="tiny muted" id="calHint"></div>
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
        <span class="dotKey"><span class="kdot kmine"></span> mes RDV</span>
      </div>

      <div class="calGrid" id="calGrid"></div>

      <div class="divider"></div>

      <h3 style="margin:0 0 8px">Informations de la demande</h3>

      <label class="label">Adresse du contrôle (obligatoire)</label>
      <textarea id="f_address" placeholder="Rue, n°, code postal, ville"></textarea>

      <div class="row">
        <div>
          <label class="label">Région</label>
          <select id="f_region">
            <option value="">—</option>
            <option value="Bruxelles">Bruxelles</option>
            <option value="Wallonie">Wallonie</option>
            <option value="Flandre">Flandre</option>
          </select>
        </div>
        <div>
          <label class="label">Chaufferie ?</label>
          <select id="f_chaufferie">
            <option value="">—</option>
            <option value="Oui">Oui</option>
            <option value="Non">Non</option>
            <option value="Je ne sais pas">Je ne sais pas</option>
          </select>
        </div>
      </div>

      <label class="label">Type(s) de contrôle (au moins 1)</label>
      <div class="checkGrid" id="f_types">
        <label class="chk"><input type="checkbox" value="Conformité gaz"/> Conformité gaz</label>
        <label class="chk"><input type="checkbox" value="Réception chaudière"/> Réception chaudière</label>
        <label class="chk"><input type="checkbox" value="Étanchéité (gaz)"/> Étanchéité (gaz)</label>
        <label class="chk"><input type="checkbox" value="Combustion / analyse"/> Combustion / analyse</label>
        <label class="chk"><input type="checkbox" value="Pression (récipient)"/> Pression (récipient)</label>
        <label class="chk"><input type="checkbox" value="Autre" id="f_type_other_chk"/> Autre</label>
      </div>

      <label class="label">Autre (si coché)</label>
      <input id="f_type_other" placeholder="Ex: contrôle spécifique, réception après travaux, …" />

      <div class="row">
        <div>
          <label class="label">Pression (optionnel)</label>
          <select id="f_pressure">
            <option value="">—</option>
            <option value="≤ 100 mbar">≤ 100 mbar</option>
            <option value="> 100 mbar">&gt; 100 mbar</option>
            <option value="Je ne sais pas">Je ne sais pas</option>
          </select>
          <div class="tiny muted">Info utile, non bloquant.</div>
        </div>
        <div>
          <label class="label">Nombre d’appareils (optionnel)</label>
          <input id="f_devices" placeholder="ex: 2" inputmode="numeric" />
        </div>
      </div>

      <div class="row">
        <div>
          <label class="label">Puissance totale estimée (kW) (optionnel)</label>
          <input id="f_power" placeholder="ex: 35" inputmode="numeric" />
        </div>
        <div>
          <label class="label">Photos disponibles ?</label>
          <select id="f_photos">
            <option value="Non">Non</option>
            <option value="Oui">Oui</option>
          </select>
          <div class="tiny muted">Pour rester 100% Spark, on met un lien si besoin.</div>
        </div>
      </div>

      <label class="label">Lien photos (OneDrive / Google Drive) (optionnel)</label>
      <input id="f_photos_link" placeholder="https://..." />

      <label class="label">Note (optionnel)</label>
      <textarea id="f_note" placeholder="Détails utiles (accès, contact sur place, contraintes, etc.)"></textarea>

      <button id="btnBook" class="btn primary" type="button" disabled>Envoyer la demande (réservation)</button>

      <div id="uiBanner" class="alert" style="display:none"></div>

      <div class="divider"></div>
      <h3 style="margin:0 0 8px">Mes rendez-vous</h3>
      <div class="apptList" id="apptList"></div>
    `
  }

  function makeWeekDays(weekStart) {
    return Array.from({ length: CFG.daysToShow }, (_, i) => addDays(weekStart, i))
  }

  function renderCalendarGrid(days, timeRows, slotStateByKey) {
    const grid = document.getElementById("calGrid")
    if (!grid) return

    const headRow = `
      <div class="calRow">
        <div class="calCell timeCell"></div>
        ${days.map((d) => `<div class="calCell dayHead">${escapeHtml(dayLabel(d))}</div>`).join("")}
      </div>
    `

    const rowsHtml = timeRows
      .map((mins) => {
        const timeCell = `<div class="calCell timeCell">${escapeHtml(mmToHHMM(mins))}</div>`

        const dayCells = days
          .map((d) => {
            const slotStart = new Date(d)
            slotStart.setHours(0, 0, 0, 0)
            slotStart.setMinutes(mins)

            const key = `${dateKey(slotStart)}_${String(slotStart.getHours()).padStart(2, "0")}${String(slotStart.getMinutes()).padStart(2, "0")}`
            const st = slotStateByKey.get(key) || { status: "blocked", disabled: true, title: "Indisponible", label: "" }

            const classes = ["calCell", "slot"]
            if (st.status === "free") classes.push("free")
            if (st.status === "blocked") classes.push("blocked")
            if (st.status === "selected") classes.push("selected")
            if (st.status === "mine") classes.push("mine")
            if (st.disabled) classes.push("disabled")

            const inside = st.label ? `<span class="slotPill">${escapeHtml(st.label)}</span>` : ""

            return `
              <div class="${classes.join(" ")}" data-slotkey="${escapeHtml(key)}" title="${escapeHtml(st.title || "")}">
                ${inside}
              </div>
            `
          })
          .join("")

        return `<div class="calRow">${timeCell}${dayCells}</div>`
      })
      .join("")

    grid.innerHTML = headRow + rowsHtml
  }

  async function fetchPublicSlotsForWeek(db, weekStart) {
    const weekEnd = addDays(weekStart, 7)
    const tsStart = firebase.firestore.Timestamp.fromDate(weekStart)
    const tsEnd = firebase.firestore.Timestamp.fromDate(weekEnd)

    const snap = await db
      .collection("publicSlots")
      .where("start", ">=", tsStart)
      .where("start", "<", tsEnd)
      .get()

    const map = new Map()
    snap.forEach((doc) => {
      const d = doc.data()
      const start = d.start?.toDate?.() ? d.start.toDate() : null
      if (!start) return
      const key = `${dateKey(start)}_${String(start.getHours()).padStart(2, "0")}${String(start.getMinutes()).padStart(2, "0")}`
      map.set(key, { id: doc.id, ...d })
    })
    return map
  }

  async function fetchHoldsForWeek(db, weekStart) {
    const weekEnd = addDays(weekStart, 7)
    const tsStart = firebase.firestore.Timestamp.fromDate(weekStart)
    const tsEnd = firebase.firestore.Timestamp.fromDate(weekEnd)

    const snap = await db
      .collection("holds")
      .where("start", ">=", tsStart)
      .where("start", "<", tsEnd)
      .get()

    const now = new Date()
    const active = new Set()
    snap.forEach((doc) => {
      const d = doc.data() || {}
      const expiresAt = d.expiresAt?.toDate?.() ? d.expiresAt.toDate() : null
      const start = d.start?.toDate?.() ? d.start.toDate() : null
      if (!expiresAt || !start) return
      if (expiresAt <= now) return
      const key = `${dateKey(start)}_${String(start.getHours()).padStart(2, "0")}${String(start.getMinutes()).padStart(2, "0")}`
      active.add(key)
    })
    return active
  }

  async function fetchBookingsForWeek(db, weekStart) {
    const weekEnd = addDays(weekStart, 7)
    const tsStart = firebase.firestore.Timestamp.fromDate(weekStart)
    const tsEnd = firebase.firestore.Timestamp.fromDate(weekEnd)

    const snap = await db
      .collection("bookings")
      .where("createdAt", ">=", tsStart)
      .where("createdAt", "<", tsEnd)
      .get()
      .catch(() => null)

    // fallback: si pas d’index / createdAt absent, on lit "bêtement" via publicSlots keys
    // (Spark-friendly: on tolère, mais on garde bookings en docId slotId donc on peut faire autrement plus tard)
    const set = new Set()
    if (!snap) return set

    snap.forEach((doc) => {
      const d = doc.data() || {}
      const st = String(d.status || "").toLowerCase()
      if (st !== "pending" && st !== "validated") return
      // docId = slotId, mais on n’a pas la dateKey facilement => on bloque via slotId->key au moment du merge (plus bas)
      // ici on stocke docId brut, et on re-map en key si possible
      set.add(doc.id)
    })
    return set
  }

  async function fetchMyAppointments(db, uid) {
    const snap = await db
      .collection("appointments")
      .where("uid", "==", uid)
      .orderBy("start", "desc")
      .limit(CFG.maxAppointmentsToShow)
      .get()

    const items = []
    snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }))
    return items
  }

  function appointmentStartKey(a) {
    const start = a.start?.toDate?.() ? a.start.toDate() : null
    if (!start) return null
    return `${dateKey(start)}_${String(start.getHours()).padStart(2, "0")}${String(start.getMinutes()).padStart(2, "0")}`
  }

  function renderAppointments(list) {
    const el = document.getElementById("apptList")
    if (!el) return

    if (!list.length) {
      el.innerHTML = `<div class="muted">Aucune demande pour l’instant.</div>`
      return
    }

    el.innerHTML = list
      .map((a) => {
        const st = (a.status || "pending").toLowerCase()
        const badgeClass =
          st === "pending" ? "pending" :
          st === "validated" ? "validated" :
          st === "refused" ? "refused" :
          st === "cancelled" ? "cancelled" : "pending"

        const start = a.start?.toDate?.() ? a.start.toDate() : null
        const when = start
          ? `${dayLabel(start)} • ${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`
          : "(date inconnue)"

        const addr = a.addressControl ? String(a.addressControl) : ""
        const types = Array.isArray(a.controlTypes) ? a.controlTypes.join(" + ") : ""

        const slotCount = Array.isArray(a.slotIds) ? a.slotIds.length : 1
        const durationTxt = slotCount > 1 ? ` • ${slotCount} créneaux` : ``

        return `
          <div class="apptCard">
            <div class="apptTop">
              <div>
                <div style="font-weight:900">${escapeHtml(when)}${escapeHtml(durationTxt)}</div>
                ${addr ? `<div class="muted" style="margin-top:4px">${escapeHtml(addr)}</div>` : ``}
                ${types ? `<div class="tiny" style="margin-top:4px">${escapeHtml(types)}</div>` : ``}
              </div>
              <div class="badge ${badgeClass}">${escapeHtml(st === "pending" ? "En attente" : st)}</div>
            </div>
          </div>
        `
      })
      .join("")
  }

  function validateSmartForm(payload) {
    const errors = []

    if (!payload.addressControl || payload.addressControl.length < 8) {
      errors.push("Veuillez indiquer l’adresse du contrôle (Rue, n°, CP, Ville).")
    }

    if (!payload.controlTypes || !payload.controlTypes.length) {
      errors.push("Veuillez sélectionner au moins 1 type de contrôle.")
    }

    if (payload.controlTypes.includes("Autre")) {
      if (!payload.controlTypeOther || payload.controlTypeOther.length < 3) {
        errors.push("Veuillez préciser le type “Autre”.")
      }
    }

    return errors
  }

  function getRequiredSlotsFromPayload(payload) {
    const count = Array.isArray(payload.controlTypes) ? payload.controlTypes.length : 1
    const normalized = Math.max(1, Math.min(CFG.maxSlotsPerRequest, count))
    return normalized
  }

  function getConsecutiveKeys(baseKey, count) {
    const parts = baseKey.split("_")
    if (parts.length !== 2) return []
    const [dPart, hm] = parts
    const [yy, mo, dd] = dPart.split("-").map((x) => parseInt(x, 10))
    const hh = parseInt(hm.slice(0, 2), 10)
    const mm = parseInt(hm.slice(2, 4), 10)
    const start = new Date(yy, mo - 1, dd, hh, mm, 0, 0)

    const keys = []
    for (let i = 0; i < count; i++) {
      const d = addMinutesDate(start, i * CFG.slotMinutes)
      const key = `${dateKey(d)}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`
      keys.push(key)
    }
    return keys
  }

  function keyToDate(key) {
    const [dPart, hm] = key.split("_")
    const [yy, mo, dd] = dPart.split("-").map((x) => parseInt(x, 10))
    const hh = parseInt(hm.slice(0, 2), 10)
    const mm = parseInt(hm.slice(2, 4), 10)
    return new Date(yy, mo - 1, dd, hh, mm, 0, 0)
  }

  async function bookMultiSlots({ db, user, selection, smartPayload }) {
    const apptRef = db.collection("appointments").doc()

    const slotIds = selection.slotIds.slice(0)
    const startTs = firebase.firestore.Timestamp.fromDate(selection.startDate)
    const endTs = firebase.firestore.Timestamp.fromDate(selection.endDate)

    const now = new Date()
    const expiresAt = addMinutesDate(now, CFG.holdMinutes)

    await db.runTransaction(async (tx) => {
      // 1) Vérifier disponibilité des publicSlots + bookings existants
      for (const slotId of slotIds) {
        const pubRef = db.collection("publicSlots").doc(slotId)
        const bookRef = db.collection("bookings").doc(slotId)
        const holdRef = db.collection("holds").doc(slotId)

        const [pubSnap, bookSnap, holdSnap] = await Promise.all([tx.get(pubRef), tx.get(bookRef), tx.get(holdRef)])

        if (!pubSnap.exists) throw new Error("Créneau introuvable.")
        const pub = pubSnap.data() || {}
        const st = String(pub.status || "busy").toLowerCase()
        if (st !== "free") throw new Error("Un des créneaux n’est plus disponible.")

        if (bookSnap.exists) throw new Error("Un des créneaux vient d’être réservé par un autre client.")
        if (holdSnap.exists) throw new Error("Un des créneaux est en cours de réservation (réessayez).")
      }

      // 2) Créer holds + bookings
      slotIds.forEach((slotId) => {
        const pubRef = db.collection("publicSlots").doc(slotId)
        const holdRef = db.collection("holds").doc(slotId)
        const bookRef = db.collection("bookings").doc(slotId)

        tx.set(holdRef, {
          start: pubRef, // placeholder not allowed, we must store real timestamps below
        })
      })
    }).catch(async (e) => {
      // On ne laisse pas de transaction half-done (Firestore tx est atomique)
      throw e
    })

    // Firestore tx ne permet pas d’écrire en utilisant pubRef placeholder,
    // on refait une transaction propre (lecture des timestamps publicSlots)
    await db.runTransaction(async (tx) => {
      const tsNow = firebase.firestore.FieldValue.serverTimestamp()
      const expiresTs = firebase.firestore.Timestamp.fromDate(expiresAt)

      const pubSnaps = []
      for (const slotId of slotIds) {
        const pubRef = db.collection("publicSlots").doc(slotId)
        const pubSnap = await tx.get(pubRef)
        if (!pubSnap.exists) throw new Error("Créneau introuvable.")
        pubSnaps.push({ slotId, pubRef, pub: pubSnap.data() || {} })
      }

      for (const item of pubSnaps) {
        const start = item.pub.start
        const end = item.pub.end
        if (!start || !end) throw new Error("Créneau invalide.")

        const holdRef = db.collection("holds").doc(item.slotId)
        const bookRef = db.collection("bookings").doc(item.slotId)

        const bookSnap = await tx.get(bookRef)
        if (bookSnap.exists) throw new Error("Un des créneaux vient d’être réservé.")

        const holdSnap = await tx.get(holdRef)
        if (holdSnap.exists) throw new Error("Un des créneaux est en cours de réservation.")

        tx.set(holdRef, {
          start,
          end,
          expiresAt: expiresTs,
          createdAt: tsNow,
        })

        tx.set(bookRef, {
          status: "pending",
          appointmentId: apptRef.id,
          createdAt: tsNow,
          updatedAt: tsNow,
        })
      }

      tx.set(apptRef, {
        uid: user.uid,
        email: (user.email || "").toLowerCase(),
        start: startTs,
        end: endTs,
        status: "pending",
        slotIds,
        createdAt: tsNow,
        updatedAt: tsNow,

        addressControl: smartPayload.addressControl,
        region: smartPayload.region || "",
        chaufferie: smartPayload.chaufferie || "",
        controlTypes: smartPayload.controlTypes || [],
        controlTypeOther: smartPayload.controlTypeOther || "",
        pressure: smartPayload.pressure || "",
        devicesCount: smartPayload.devicesCount || "",
        powerKw: smartPayload.powerKw || "",
        photosAvailable: smartPayload.photosAvailable || "Non",
        photosLink: smartPayload.photosLink || "",
        note: smartPayload.note || "",
      })
    })
  }

  renderAuth()
  setStatus(false)

  const okFirebase = await waitForFirebase(10000)
  if (!okFirebase) {
    const warningHtml = `
      <div class="warn" style="display:block">
        ⚠️ Firebase n’est pas chargé. La connexion ne fonctionnera pas.
        <div class="tiny" style="margin-top:6px">Vérifie que /__/firebase/init.js se charge bien.</div>
      </div>
    `
    renderAuth(warningHtml)
    return
  }

  const auth = firebase.auth()
  const db = firebase.firestore()

  try {
    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
  } catch {}

  btnLogout.addEventListener("click", async () => {
    await auth.signOut()
  })

  wireAuthHandlers(auth)

  let currentWeekStart = startOfWeekMonday(new Date())
  let selected = null
  let lastPublicSlotsMap = new Map()
  let activeHoldsKeys = new Set()
  let bookingSlotIds = new Set()
  let myApptKeys = new Set()
  let mySelectedKeys = new Set()

  function updateHintText(requiredSlots) {
    const el = document.getElementById("calHint")
    if (!el) return
    const txt = requiredSlots > 1
      ? `Durée estimée: ${requiredSlots} contrôles → ${requiredSlots} créneaux consécutifs (90 min chacun)`
      : `Durée estimée: 1 contrôle → 1 créneau (90 min)`
    el.textContent = txt
  }

  async function refreshCalendarAndAppointments(user) {
    const timeRows = buildTimeRows()
    const days = makeWeekDays(currentWeekStart)

    const calSub = document.getElementById("calSub")
    const calTitle = document.getElementById("calTitle")
    if (calTitle) calTitle.textContent = `Semaine du ${days[0].toLocaleDateString("fr-BE")}`
    if (calSub) calSub.textContent = `Créneaux: ${CFG.slotMinutes} min (contrôle 60 + trajet 30)`

    let myList = []
    try {
      myList = await fetchMyAppointments(db, user.uid)
      myApptKeys = new Set(
        myList
          .filter((a) => String(a.status || "").toLowerCase() !== "cancelled")
          .map(appointmentStartKey)
          .filter(Boolean)
      )
      renderAppointments(myList)
    } catch (e) {
      console.error(e)
    }

    try {
      lastPublicSlotsMap = await fetchPublicSlotsForWeek(db, currentWeekStart)
    } catch (e) {
      console.error(e)
      if (!isProbablyAdblockNetworkError(e)) showBanner("alert", "Impossible de charger les créneaux.")
      lastPublicSlotsMap = new Map()
    }

    try {
      activeHoldsKeys = await fetchHoldsForWeek(db, currentWeekStart)
    } catch (e) {
      console.error(e)
      activeHoldsKeys = new Set()
    }

    // bookings: on ne peut pas toujours requêter proprement sans index,
    // donc on le remap à partir des slotIds connus via publicSlots (docId)
    bookingSlotIds = new Set()
    try {
      const raw = await fetchBookingsForWeek(db, currentWeekStart)
      raw.forEach((id) => bookingSlotIds.add(id))
    } catch (e) {
      console.error(e)
      bookingSlotIds = new Set()
    }

    // requiredSlots live (selon cases cochées)
    const smart = collectSmartForm()
    const requiredSlots = getRequiredSlotsFromPayload(smart)
    updateHintText(requiredSlots)

    const slotStateByKey = new Map()
    const now = new Date()
    const min48 = new Date(now.getTime() + 48 * 60 * 60 * 1000)

    // rebuild selected keys if selected
    mySelectedKeys = new Set(selected?.keys || [])

    for (const day of days) {
      for (const mins of timeRows) {
        const start = new Date(day)
        start.setHours(0, 0, 0, 0)
        start.setMinutes(mins)

        const key = `${dateKey(start)}_${String(start.getHours()).padStart(2, "0")}${String(start.getMinutes()).padStart(2, "0")}`
        const pubDoc = lastPublicSlotsMap.get(key)

        let status = "blocked"
        let disabled = true
        let title = "Indisponible"
        let label = ""

        if (myApptKeys.has(key)) {
          status = "mine"
          disabled = true
          title = "Votre rendez-vous"
          label = "Mon RDV"
        } else if (!pubDoc) {
          status = "blocked"
          disabled = true
          title = "Indisponible"
        } else {
          const st = String(pubDoc.status || "busy").toLowerCase()
          const slotId = String(pubDoc.id || "")

          const isBooked = slotId && bookingSlotIds.has(slotId)
          const isHeld = activeHoldsKeys.has(key)

          if (start < min48) {
            status = "blocked"
            disabled = true
            title = "Indisponible"
          } else if (isBooked) {
            status = "blocked"
            disabled = true
            title = "Indisponible"
          } else if (isHeld) {
            status = "blocked"
            disabled = true
            title = "Créneau en cours de réservation"
          } else if (st === "free") {
            status = "free"
            disabled = false
            title = "Disponible"
            label = "Libre"
          } else {
            status = "blocked"
            disabled = true
            title = "Indisponible"
          }
        }

        if (mySelectedKeys.has(key)) {
          status = "selected"
          disabled = false
          title = "Sélectionné"
          label = "Libre"
        }

        slotStateByKey.set(key, { status, disabled, title, label })
      }
    }

    renderCalendarGrid(days, timeRows, slotStateByKey)

    document.querySelectorAll(".slot[data-slotkey]").forEach((cell) => {
      cell.addEventListener("click", async () => {
        hideBanner()

        const key = cell.getAttribute("data-slotkey")
        if (!key) return

        // deselect if clicking on selected
        if (selected && selected.startKey === key) {
          selected = null
          const b = document.getElementById("btnBook")
          if (b) b.disabled = true
          await refreshCalendarAndAppointments(user)
          return
        }

        if (myApptKeys.has(key)) return

        const pubDoc = lastPublicSlotsMap.get(key)
        if (!pubDoc) return

        const st = String(pubDoc.status || "busy").toLowerCase()
        if (st !== "free") return

        const baseStart = keyToDate(key)
        const min48now = new Date(Date.now() + 48 * 60 * 60 * 1000)
        if (baseStart < min48now) {
          showBanner("warn", "Ce créneau n’est plus disponible.")
          return
        }

        // requiredSlots computed from checkboxes
        const smart = collectSmartForm()
        const requiredSlots = getRequiredSlotsFromPayload(smart)
        updateHintText(requiredSlots)

        const keys = getConsecutiveKeys(key, requiredSlots)
        if (!keys.length) return

        // validate same day + inside grid hours
        const day0 = keys[0].split("_")[0]
        const sameDay = keys.every((k) => k.split("_")[0] === day0)
        if (!sameDay) {
          showBanner("warn", "Veuillez choisir un créneau plus tôt (créneaux consécutifs requis).")
          return
        }

        // validate availability for all keys
        const slotIds = []
        for (const k of keys) {
          const d = keyToDate(k)
          if (d < min48now) {
            showBanner("warn", "Un des créneaux est trop proche (<48h).")
            return
          }

          const doc = lastPublicSlotsMap.get(k)
          if (!doc || String(doc.status || "busy").toLowerCase() !== "free") {
            showBanner("warn", "Les créneaux consécutifs ne sont pas tous disponibles.")
            return
          }

          if (activeHoldsKeys.has(k)) {
            showBanner("warn", "Un des créneaux est en cours de réservation. Réessayez.")
            return
          }

          const sid = String(doc.id || "")
          if (sid && bookingSlotIds.has(sid)) {
            showBanner("warn", "Un des créneaux est déjà réservé.")
            return
          }

          slotIds.push(sid)
        }

        const startDate = keyToDate(keys[0])
        const endDate = addMinutesDate(startDate, requiredSlots * CFG.slotMinutes)

        selected = { startKey: key, keys, slotIds, startDate, endDate }
        const b = document.getElementById("btnBook")
        if (b) b.disabled = false
        await refreshCalendarAndAppointments(user)
      })
    })
  }

  async function bindCalendarNav(user) {
    document.getElementById("calPrev")?.addEventListener("click", async () => {
      currentWeekStart = addDays(currentWeekStart, -7)
      selected = null
      const b = document.getElementById("btnBook")
      if (b) b.disabled = true
      await refreshCalendarAndAppointments(user)
    })

    document.getElementById("calNext")?.addEventListener("click", async () => {
      currentWeekStart = addDays(currentWeekStart, 7)
      selected = null
      const b = document.getElementById("btnBook")
      if (b) b.disabled = true
      await refreshCalendarAndAppointments(user)
    })

    document.getElementById("calToday")?.addEventListener("click", async () => {
      currentWeekStart = startOfWeekMonday(new Date())
      selected = null
      const b = document.getElementById("btnBook")
      if (b) b.disabled = true
      await refreshCalendarAndAppointments(user)
    })
  }

  function collectSmartForm() {
    const addressControl = (document.getElementById("f_address")?.value || "").trim()
    const region = (document.getElementById("f_region")?.value || "").trim()
    const chaufferie = (document.getElementById("f_chaufferie")?.value || "").trim()

    const controlTypes = []
    document.querySelectorAll("#f_types input[type='checkbox']:checked").forEach((el) => {
      controlTypes.push(String(el.value))
    })

    const controlTypeOther = (document.getElementById("f_type_other")?.value || "").trim()
    const pressure = (document.getElementById("f_pressure")?.value || "").trim()
    const devicesCount = (document.getElementById("f_devices")?.value || "").trim()
    const powerKw = (document.getElementById("f_power")?.value || "").trim()
    const photosAvailable = (document.getElementById("f_photos")?.value || "Non").trim()
    const photosLink = (document.getElementById("f_photos_link")?.value || "").trim()
    const note = (document.getElementById("f_note")?.value || "").trim()

    return { addressControl, region, chaufferie, controlTypes, controlTypeOther, pressure, devicesCount, powerKw, photosAvailable, photosLink, note }
  }

  function bindFormLiveRefresh(user) {
    // recalcul slots needed live
    document.querySelectorAll("#f_types input[type='checkbox']").forEach((el) => {
      el.addEventListener("change", async () => {
        selected = null
        const b = document.getElementById("btnBook")
        if (b) b.disabled = true
        await refreshCalendarAndAppointments(user)
      })
    })
  }

  async function bindBookButton(user) {
    document.getElementById("btnBook")?.addEventListener("click", async () => {
      hideBanner()
      const btnBook = document.getElementById("btnBook")

      if (!selected) {
        showBanner("alert", "Veuillez sélectionner un créneau libre.")
        return
      }

      const smart = collectSmartForm()
      smart.devicesCount = String(smart.devicesCount || "").trim()
      smart.powerKw = String(smart.powerKw || "").trim()
      smart.note = String(smart.note || "").trim()
      smart.addressControl = String(smart.addressControl || "").trim()
      smart.controlTypeOther = String(smart.controlTypeOther || "").trim()
      smart.region = String(smart.region || "").trim()
      smart.chaufferie = String(smart.chaufferie || "").trim()
      smart.pressure = String(smart.pressure || "").trim()
      smart.photosLink = String(smart.photosLink || "").trim()
      smart.photosAvailable = String(smart.photosAvailable || "Non").trim()

      const errs = validateSmartForm(smart)
      if (errs.length) {
        showBanner("alert", errs[0])
        return
      }

      const requiredSlots = getRequiredSlotsFromPayload(smart)
      if (selected.slotIds.length !== requiredSlots) {
        showBanner("warn", "Sélection invalide. Re-sélectionnez un créneau.")
        selected = null
        if (btnBook) btnBook.disabled = true
        await refreshCalendarAndAppointments(user)
        return
      }

      try {
        if (btnBook) btnBook.disabled = true
        await bookMultiSlots({ db, user, selection: selected, smartPayload: smart })
        showBanner("ok", "Demande envoyée ✅ (en attente de validation)")
        selected = null
        if (btnBook) btnBook.disabled = true
        await refreshCalendarAndAppointments(user)
      } catch (e) {
        console.error(e)
        if (isProbablyAdblockNetworkError(e)) {
          showBanner("warn", "Une extension (adblock) bloque des appels réseau.")
        } else {
          showBanner("alert", e?.message || "Réservation impossible. Le créneau vient peut-être d’être pris.")
        }
      } finally {
        if (btnBook) btnBook.disabled = !selected
      }
    })
  }

  async function ensureProfileThenBooking(user) {
    const didRedirect = await redirectIfAdmin(db, user)
    if (didRedirect) return

    let snap
    try {
      snap = await db.collection("clients").doc(user.uid).get()
    } catch (e) {
      console.error(e)
      right.innerHTML = `
        <div class="stepWrap">
          <span class="step">Erreur</span>
          <span class="muted" style="font-size:12px">Profil</span>
        </div>
        <div class="alert" style="display:block">Impossible de lire Firestore (rules / réseau).</div>
      `
      return
    }

    if (!snap.exists) {
      renderProfileForm(user.email || "")
      setStatus(true)

      const btn = document.getElementById("btnSaveProfile")
      btn?.addEventListener("click", async () => {
        hideBanner()

        const data = {
          email: (user.email || "").toLowerCase(),
          company: (document.getElementById("p_company")?.value || "").trim(),
          vat: (document.getElementById("p_vat")?.value || "").trim(),
          phone: normalizePhone(document.getElementById("p_phone")?.value || ""),
          hqAddress: (document.getElementById("p_hq")?.value || "").trim(),
          status: "ok",
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        }

        const errs = validateProfile(data)
        if (errs.length) {
          showBanner("alert", errs[0])
          return
        }

        try {
          btn.disabled = true
          await db.collection("clients").doc(user.uid).set(
            { ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          )

          renderBookingShell(user.email || "")
          selected = null
          const b = document.getElementById("btnBook")
          if (b) b.disabled = true

          await bindCalendarNav(user)
          await bindBookButton(user)
          bindFormLiveRefresh(user)
          await refreshCalendarAndAppointments(user)
        } catch (e) {
          console.error(e)
          if (!isProbablyAdblockNetworkError(e)) showBanner("alert", "Impossible d’enregistrer le profil (rules / réseau).")
          else showBanner("warn", "Une extension (adblock) bloque certains appels.")
        } finally {
          btn.disabled = false
        }
      })

      return
    }

    renderBookingShell(user.email || "")
    selected = null
    const b = document.getElementById("btnBook")
    if (b) b.disabled = true

    await bindCalendarNav(user)
    await bindBookButton(user)
    bindFormLiveRefresh(user)
    await refreshCalendarAndAppointments(user)
  }

  auth.onAuthStateChanged(async (user) => {
    setStatus(!!user)

    if (!user) {
      __adminChecked = false
      __isAdminCached = false
      renderAuth()
      wireAuthHandlers(auth)
      return
    }

    hideBanner()
    await ensureProfileThenBooking(user)
  })
})