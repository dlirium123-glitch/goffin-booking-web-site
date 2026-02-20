// =======================================================
// Goffin Booking — index.v3.js (PRO)
// Step4: Spark-only booking (publicSlots + holds + bookings)
// - UI lit publicSlots (read-only) + holds (locks) + bookings (mes demandes)
// - Le client N'ECRIT PAS dans publicSlots (sinon 403)
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
    slotMinutes: 90,            // grille visible
    appointmentMinutes: 60,     // info only
    holdMinutes: 30,            // hold TTL
    weeksToShowLabel: "Semaine",
    maxBookingsToShow: 12
  }

  // ------------------------------
  // Utils
  // ------------------------------
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

  // slotId expected by rules: YYYYMMDD_HHMM
  function slotIdFromDate(d) {
    const y = String(d.getFullYear())
    const mo = String(d.getMonth() + 1).padStart(2, "0")
    const da = String(d.getDate()).padStart(2, "0")
    const hh = String(d.getHours()).padStart(2, "0")
    const mm = String(d.getMinutes()).padStart(2, "0")
    return `${y}${mo}${da}_${hh}${mm}`
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

  function showPanel(panelId) {
    ;["panelLogin", "panelSignup"].forEach((id) => {
      const el = document.getElementById(id)
      if (el) el.style.display = id === panelId ? "block" : "none"
    })
    hideBanner()
  }

  // ------------------------------
  // Auth UI
  // ------------------------------
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

    btnLogin?.addEventListener("click", async () => {
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

    btnForgot?.addEventListener("click", async () => {
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

    btnSignup?.addEventListener("click", async () => {
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

  // ------------------------------
  // Admin detection
  // ------------------------------
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
    setTimeout(() => (window.location.href = "/admin"), 250)
    return true
  }

  // ------------------------------
  // Profile UI
  // ------------------------------
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

  function normalizePhone(s) {
    return String(s || "").trim()
  }

  // ------------------------------
  // Booking UI shell
  // ------------------------------
  function renderBookingShell(userEmail) {
    right.innerHTML = `
      <div class="stepWrap">
        <span class="step">Étape 3/3 — Demande de rendez-vous</span>
        <span class="muted" style="font-size:12px">${escapeHtml(userEmail || "")}</span>
      </div>

      <div class="callout green">
        <strong>Profil OK ✅</strong>
        <div class="muted">Choisissez un créneau libre. Les indisponibilités (Outlook / règles internes) sont masquées.</div>
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

  // ------------------------------
  // Data fetch (PUBLIC)
  // ------------------------------
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

    const holds = new Map()
    const now = new Date()

    snap.forEach((doc) => {
      const d = doc.data() || {}
      const start = d.start?.toDate?.() ? d.start.toDate() : null
      const expiresAt = d.expiresAt?.toDate?.() ? d.expiresAt.toDate() : null
      if (!start || !expiresAt) return

      // ignore expired holds visually
      if (expiresAt <= now) return

      const key = `${dateKey(start)}_${String(start.getHours()).padStart(2, "0")}${String(start.getMinutes()).padStart(2, "0")}`
      holds.set(key, { id: doc.id, ...d })
    })

    return holds
  }

  async function fetchMyBookings(db, uid) {
    const snap = await db
      .collection("bookings")
      .where("uid", "==", uid)
      .orderBy("start", "desc")
      .limit(CFG.maxBookingsToShow)
      .get()

    const items = []
    snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }))
    return items
  }

  function bookingStartKey(a) {
    const start = a.start?.toDate?.() ? a.start.toDate() : null
    if (!start) return null
    return `${dateKey(start)}_${String(start.getHours()).padStart(2, "0")}${String(start.getMinutes()).padStart(2, "0")}`
  }

  function renderBookings(list) {
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

        return `
          <div class="apptCard">
            <div class="apptTop">
              <div>
                <div style="font-weight:900">${escapeHtml(when)}</div>
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

  // ------------------------------
  // Booking transaction (Spark-safe)
  // - Create hold + booking with deterministic IDs (slotId)
  // - Do NOT update publicSlots (read-only)
  // ------------------------------
  async function bookSlot(db, user, selected, smartPayload) {
    const slotId = selected.slotId
    const holdRef = db.collection("holds").doc(slotId)
    const bookingRef = db.collection("bookings").doc(slotId)

    const startTs = firebase.firestore.Timestamp.fromDate(selected.startDate)
    const endTs = firebase.firestore.Timestamp.fromDate(selected.endDate)

    const expiresAt = addMinutesDate(new Date(), CFG.holdMinutes)
    const expiresAtTs = firebase.firestore.Timestamp.fromDate(expiresAt)

    await db.runTransaction(async (tx) => {
      // 1) Check hold does not exist
      const holdSnap = await tx.get(holdRef)
      if (holdSnap.exists) {
        // if it's yours you could allow, but keep simple
        throw new Error("Ce créneau est en cours de réservation par un autre client. Réessayez plus tard.")
      }

      // 2) Check booking does not exist
      const bookingSnap = await tx.get(bookingRef)
      if (bookingSnap.exists) {
        throw new Error("Ce créneau n’est plus disponible.")
      }

      // 3) Create hold
      tx.set(holdRef, {
        uid: user.uid,
        status: "hold",
        slotId,
        start: startTs,
        end: endTs,
        expiresAt: expiresAtTs,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      })

      // 4) Create booking (pending)
      tx.set(bookingRef, {
        uid: user.uid,
        email: (user.email || "").toLowerCase(),
        slotId,
        start: startTs,
        end: endTs,
        status: "pending",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),

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
        note: smartPayload.note || ""
      })
    })
  }

  // ------------------------------
  // Calendar logic
  // ------------------------------
  let currentWeekStart = startOfWeekMonday(new Date())
  let selectedSlot = null
  let publicSlotsMap = new Map()
  let holdsMap = new Map()
  let myBookingKeys = new Set()

  async function refreshCalendarAndBookings(user) {
    const timeRows = buildTimeRows()
    const days = makeWeekDays(currentWeekStart)

    const calSub = document.getElementById("calSub")
    const calTitle = document.getElementById("calTitle")
    if (calTitle) calTitle.textContent = `Semaine du ${days[0].toLocaleDateString("fr-BE")}`
    if (calSub) calSub.textContent = `Créneaux: ${CFG.slotMinutes} min (contrôle ${CFG.appointmentMinutes} + trajet)`

    // my bookings
    let myList = []
    try {
      myList = await fetchMyBookings(db, user.uid)
      myBookingKeys = new Set(
        myList
          .filter((a) => String(a.status || "").toLowerCase() !== "cancelled")
          .map(bookingStartKey)
          .filter(Boolean)
      )
      renderBookings(myList)
    } catch (e) {
      console.error(e)
    }

    // public slots
    try {
      publicSlotsMap = await fetchPublicSlotsForWeek(db, currentWeekStart)
    } catch (e) {
      console.error(e)
      if (!isProbablyAdblockNetworkError(e)) showBanner("alert", "Impossible de charger les créneaux.")
      publicSlotsMap = new Map()
    }

    // holds
    try {
      holdsMap = await fetchHoldsForWeek(db, currentWeekStart)
    } catch (e) {
      console.error(e)
      holdsMap = new Map()
    }

    const slotStateByKey = new Map()
    const now = new Date()
    const min48 = new Date(now.getTime() + 48 * 60 * 60 * 1000)

    for (const day of days) {
      for (const mins of timeRows) {
        const start = new Date(day)
        start.setHours(0, 0, 0, 0)
        start.setMinutes(mins)

        const key = `${dateKey(start)}_${String(start.getHours()).padStart(2, "0")}${String(start.getMinutes()).padStart(2, "0")}`
        const pub = publicSlotsMap.get(key)
        const hold = holdsMap.get(key)

        let status = "blocked"
        let disabled = true
        let title = "Indisponible"
        let label = ""

        if (myBookingKeys.has(key)) {
          status = "mine"
          disabled = true
          title = "Votre demande"
          label = "Mon RDV"
        } else if (start < min48) {
          status = "blocked"
          disabled = true
          title = "Indisponible"
        } else if (!pub) {
          status = "blocked"
          disabled = true
          title = "Indisponible"
        } else {
          const st = String(pub.status || "busy").toLowerCase()

          // If another client holds => blocked
          if (hold && String(hold.uid || "") !== String(user.uid || "")) {
            status = "blocked"
            disabled = true
            title = "Indisponible"
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

        if (selectedSlot && selectedSlot.key === key) {
          const stillFree = !!pub && String(pub.status || "").toLowerCase() === "free" && start >= min48 && !hold
          if (!stillFree) {
            selectedSlot = null
          } else {
            status = "selected"
            disabled = false
            title = "Sélectionné"
            label = "Libre"
          }
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

        // toggle off
        if (selectedSlot && selectedSlot.key === key) {
          selectedSlot = null
          const b = document.getElementById("btnBook")
          if (b) b.disabled = true
          await refreshCalendarAndBookings(user)
          return
        }

        if (myBookingKeys.has(key)) return

        const pub = publicSlotsMap.get(key)
        if (!pub || String(pub.status || "").toLowerCase() !== "free") return

        const hold = holdsMap.get(key)
        if (hold && String(hold.uid || "") !== String(user.uid || "")) return

        const [dPart, hm] = key.split("_")
        const [yy, mo, dd] = dPart.split("-").map((x) => parseInt(x, 10))
        const hh = parseInt(hm.slice(0, 2), 10)
        const mm = parseInt(hm.slice(2, 4), 10)
        const start = new Date(yy, mo - 1, dd, hh, mm, 0, 0)

        const min48now = new Date(Date.now() + 48 * 60 * 60 * 1000)
        if (start < min48now) {
          showBanner("warn", "Ce créneau n’est plus disponible.")
          return
        }

        const end = addMinutesDate(start, CFG.slotMinutes)

        const slotId = slotIdFromDate(start) // YYYYMMDD_HHMM
        selectedSlot = { key, startDate: start, endDate: end, slotId }
        const b = document.getElementById("btnBook")
        if (b) b.disabled = false
        await refreshCalendarAndBookings(user)
      })
    })
  }

  async function bindCalendarNav(user) {
    document.getElementById("calPrev")?.addEventListener("click", async () => {
      currentWeekStart = addDays(currentWeekStart, -7)
      selectedSlot = null
      const b = document.getElementById("btnBook")
      if (b) b.disabled = true
      await refreshCalendarAndBookings(user)
    })

    document.getElementById("calNext")?.addEventListener("click", async () => {
      currentWeekStart = addDays(currentWeekStart, 7)
      selectedSlot = null
      const b = document.getElementById("btnBook")
      if (b) b.disabled = true
      await refreshCalendarAndBookings(user)
    })

    document.getElementById("calToday")?.addEventListener("click", async () => {
      currentWeekStart = startOfWeekMonday(new Date())
      selectedSlot = null
      const b = document.getElementById("btnBook")
      if (b) b.disabled = true
      await refreshCalendarAndBookings(user)
    })
  }

  async function bindBookButton(user) {
    document.getElementById("btnBook")?.addEventListener("click", async () => {
      hideBanner()
      const btnBook = document.getElementById("btnBook")

      if (!selectedSlot) {
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

      try {
        if (btnBook) btnBook.disabled = true
        await bookSlot(db, user, selectedSlot, smart)
        showBanner("ok", "Demande envoyée ✅ (en attente de validation)")
        selectedSlot = null
        if (btnBook) btnBook.disabled = true
        await refreshCalendarAndBookings(user)
      } catch (e) {
        console.error(e)
        if (isProbablyAdblockNetworkError(e)) {
          showBanner("warn", "Une extension (adblock) bloque des appels réseau.")
        } else {
          showBanner("alert", e?.message || "Réservation impossible. Le créneau vient peut-être d’être pris.")
        }
      } finally {
        if (btnBook) btnBook.disabled = !selectedSlot
      }
    })
  }

  // ------------------------------
  // Profile -> Booking
  // ------------------------------
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
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
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
          selectedSlot = null
          const b = document.getElementById("btnBook")
          if (b) b.disabled = true

          await bindCalendarNav(user)
          await bindBookButton(user)
          await refreshCalendarAndBookings(user)
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
    selectedSlot = null
    const b = document.getElementById("btnBook")
    if (b) b.disabled = true

    await bindCalendarNav(user)
    await bindBookButton(user)
    await refreshCalendarAndBookings(user)
  }

  // ------------------------------
  // Boot
  // ------------------------------
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