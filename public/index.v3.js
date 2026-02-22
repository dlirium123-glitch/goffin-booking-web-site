// =======================================================
// Goffin Booking — index.v3.js (PRO)
// Step6: Spark-only booking (publicSlots + holds + bookings) + MULTI-SLOTS
// - UI lit publicSlots (read-only) + holds (locks) + bookings (mes demandes)
// - Client n'écrit PAS dans publicSlots (sinon 403)
// - Multi: durée = nbTech*60 + 30 (trajet 1x), slots = ceil(durée / 90)
// - "Mes demandes" regroupées par requestId (1 carte par demande)
// - Transaction Spark-safe: on ne lit PAS bookings/{slotId} (sinon 403 si doc absent)
// =======================================================
const INDEX_VERSION = "v3-2026-02-21-PRO-step6"
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

  // =====================================================
  // Config
  // =====================================================
  const CFG = {
    daysToShow: 5,
    startMinutes: 9 * 60 + 30,
    endMinutes: 17 * 60 + 30,

    slotMinutes: 90, // grille
    controlMinutes: 60, // 1 technique = 60
    travelMinutes: 30, // trajet 1x par demande

    holdMinutes: 30, // hold TTL
    weeksToShowLabel: "Semaine",
    maxBookingsToShow: 40, // on groupe ensuite par requestId
  }

  // =====================================================
  // Utils
  // =====================================================
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
    return `${names[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}`
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

  function normalizePhone(s) {
    return String(s || "").trim()
  }

  function makeWeekDays(weekStart) {
    return Array.from({ length: CFG.daysToShow }, (_, i) => addDays(weekStart, i))
  }

  function keyFromStartDate(start) {
    return `${dateKey(start)}_${String(start.getHours()).padStart(2, "0")}${String(start.getMinutes()).padStart(
      2,
      "0"
    )}`
  }

  function parseKeyToDate(key) {
    const [dPart, hm] = String(key || "").split("_")
    if (!dPart || !hm || hm.length < 4) return null
    const [yy, mo, dd] = dPart.split("-").map((x) => parseInt(x, 10))
    const hh = parseInt(hm.slice(0, 2), 10)
    const mm = parseInt(hm.slice(2, 4), 10)
    const dt = new Date(yy, mo - 1, dd, hh, mm, 0, 0)
    return Number.isNaN(dt.getTime()) ? null : dt
  }

  function computeWantedSlotsCountFromForm() {
    // Durée totale = nbTech*60 + 30 (trajet 1x)
    const checked = document.querySelectorAll("#f_types input[type='checkbox']:checked")
    const nbTech = Math.max(1, checked ? checked.length : 0)
    const total = nbTech * CFG.controlMinutes + CFG.travelMinutes
    return Math.max(1, Math.ceil(total / CFG.slotMinutes))
  }

  function computeCalSubLabel() {
    const checked = document.querySelectorAll("#f_types input[type='checkbox']:checked")
    const nbTech = Math.max(1, checked ? checked.length : 0)
    const total = nbTech * CFG.controlMinutes + CFG.travelMinutes
    const slots = Math.max(1, Math.ceil(total / CFG.slotMinutes))
    return `Créneaux: ${CFG.slotMinutes} min • Techniques: ${nbTech} • Durée calculée: ${total} min • Slots réservés: ${slots}`
  }

  // =====================================================
  // Auth UI
  // =====================================================
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

  // =====================================================
  // Admin detection
  // =====================================================
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

  // =====================================================
  // Profile UI
  // =====================================================
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

  // =====================================================
  // Booking UI shell
  // =====================================================
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

      <div class="tiny muted" style="margin-top:6px">
        Durée = nb techniques × 60 min + 30 min (trajet 1x). La réservation se fait en slots de 90 min.
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

  // =====================================================
  // Calendar render
  // =====================================================
  function renderCalendarGrid(days, timeRows, slotStateByKey, selectedKeysSet) {
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

            const key = keyFromStartDate(slotStart)
            const st = slotStateByKey.get(key) || { status: "blocked", disabled: true, title: "Indisponible", label: "" }

            const classes = ["calCell", "slot"]
            if (st.status === "free") classes.push("free")
            else classes.push("blocked")
            if (st.status === "mine") classes.push("mine")
            if (selectedKeysSet && selectedKeysSet.has(key)) classes.push("selected")

            const title = escapeHtml(st.title || "")
            const label = escapeHtml(st.label || "")

            return `<button class="${classes.join(" ")}" data-key="${escapeHtml(key)}" type="button" ${
              st.disabled ? "disabled" : ""
            } title="${title}">
              ${label}
            </button>`
          })
          .join("")

        return `<div class="calRow">${timeCell}${dayCells}</div>`
      })
      .join("")

    grid.innerHTML = headRow + rowsHtml
  }

  // =====================================================
  // Firebase init
  // =====================================================
  const okFirebase = await waitForFirebase(10000)
  if (!okFirebase) {
    renderAuth(`<div class="warn" style="display:block">Firebase non chargé. Vérifiez /__/firebase/init.js</div>`)
    return
  }

  const auth = firebase.auth()
  const db = firebase.firestore()

  try {
    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
  } catch {
    // ignore
  }

  // Collections (Spark-only)
  const profilesCol = db.collection("profiles")
  const adminsCol = db.collection("admins")
  const publicSlotsCol = db.collection("publicSlots") // (read-only)
  const holdsCol = db.collection("holds")
  const bookingsCol = db.collection("bookings")

  // =====================================================
  // Profile logic
  // =====================================================
  async function loadMyProfile(uid) {
    const snap = await profilesCol.doc(uid).get()
    return snap.exists ? snap.data() : null
  }

  async function saveMyProfile(uid, data) {
    const payload = {
      ...data,
      phone: normalizePhone(data.phone),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    }

    await profilesCol.doc(uid).set(payload, { merge: true })
  }

  // =====================================================
  // Calendar data fetch (publicSlots + holds + my bookings)
  // =====================================================
  function isExpiredHold(holdData) {
    try {
      const exp = holdData?.expiresAt?.toDate ? holdData.expiresAt.toDate() : null
      if (!exp) return false
      return exp.getTime() <= Date.now()
    } catch {
      return false
    }
  }

  async function fetchPublicSlotsForWeek(days) {
    const start = startOfDay(days[0])
    const end = addDays(start, CFG.daysToShow)
    const snap = await publicSlotsCol.where("start", ">=", start).where("start", "<", end).get()
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  }

  async function fetchHoldsForWeek(days) {
    const start = startOfDay(days[0])
    const end = addDays(start, CFG.daysToShow)

    const snap = await holdsCol.where("start", ">=", start).where("start", "<", end).get()
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    return items.filter((x) => !isExpiredHold(x))
  }

  async function fetchMyBookingsForWeek(uid, days) {
    const start = startOfDay(days[0])
    const end = addDays(start, CFG.daysToShow)

    const snap = await bookingsCol
      .where("uid", "==", uid)
      .where("start", ">=", start)
      .where("start", "<", end)
      .limit(CFG.maxBookingsToShow)
      .get()

    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  }

  // =====================================================
  // Slot state mapping
  // =====================================================
  function slotTitleFromState(st) {
    if (st.status === "free") return "Libre"
    if (st.status === "mine") return "Votre demande"
    if (st.status === "hold") return "En cours de réservation"
    return "Indisponible"
  }

  function buildSlotStateByKey(days, timeRows, publicSlots, holds, myBookings) {
    const map = new Map()

    // init all blocked by default
    for (const d of days) {
      for (const mins of timeRows) {
        const slotStart = new Date(d)
        slotStart.setHours(0, 0, 0, 0)
        slotStart.setMinutes(mins)
        const key = keyFromStartDate(slotStart)
        map.set(key, { status: "blocked", disabled: true, title: "Indisponible", label: "" })
      }
    }

    // publicSlots: mark free
    for (const s of publicSlots) {
      const start = s.start?.toDate ? s.start.toDate() : null
      if (!start) continue
      const key = keyFromStartDate(start)
      const st = String(s.status || "").toLowerCase()
      if (st === "free") {
        map.set(key, { status: "free", disabled: false, title: "Libre", label: "" })
      } else {
        map.set(key, { status: "blocked", disabled: true, title: "Indisponible", label: "" })
      }
    }

    // holds: mark hold (disabled)
    for (const h of holds) {
      const start = h.start?.toDate ? h.start.toDate() : null
      if (!start) continue
      const key = keyFromStartDate(start)
      map.set(key, { status: "hold", disabled: true, title: "En cours de réservation", label: "" })
    }

    // my bookings: mark mine
    for (const b of myBookings) {
      const start = b.start?.toDate ? b.start.toDate() : null
      if (!start) continue
      const key = keyFromStartDate(start)
      map.set(key, { status: "mine", disabled: true, title: "Votre demande", label: "" })
    }

    // label set: show dot on free/mine maybe
    for (const [k, st] of map.entries()) {
      st.label = st.status === "free" ? "•" : st.status === "mine" ? "•" : ""
      st.title = slotTitleFromState(st)
      map.set(k, st)
    }

    return map
  }

  // =====================================================
  // Selection logic: range selection for multi-slots
  // =====================================================
  function canSelectRange(slotStateByKey, startKey, slotsCount) {
    const start = parseKeyToDate(startKey)
    if (!start) return false

    for (let i = 0; i < slotsCount; i++) {
      const d = addMinutesDate(start, i * CFG.slotMinutes)
      const key = keyFromStartDate(d)
      const st = slotStateByKey.get(key)
      if (!st || st.status !== "free" || st.disabled) return false
    }
    return true
  }

  function keysForRange(startKey, slotsCount) {
    const start = parseKeyToDate(startKey)
    if (!start) return []
    const keys = []
    for (let i = 0; i < slotsCount; i++) {
      const d = addMinutesDate(start, i * CFG.slotMinutes)
      keys.push(keyFromStartDate(d))
    }
    return keys
  }

  function apply48hRule(slotStateByKey) {
    // slots < 48h are blocked
    const minTs = Date.now() + 48 * 60 * 60 * 1000
    for (const [k, st] of slotStateByKey.entries()) {
      const d = parseKeyToDate(k)
      if (!d) continue
      if (d.getTime() < minTs) {
        slotStateByKey.set(k, { status: "blocked", disabled: true, title: "Indisponible (moins de 48h)", label: "" })
      }
    }
  }

  // =====================================================
  // Smart payload builder (form)
  // =====================================================
  function readFormPayload() {
    const addressControl = String(document.getElementById("f_address")?.value || "").trim()
    const region = String(document.getElementById("f_region")?.value || "").trim()
    const chaufferie = String(document.getElementById("f_chaufferie")?.value || "").trim()

    const checked = Array.from(document.querySelectorAll("#f_types input[type='checkbox']:checked")).map((x) =>
      String(x?.value || "").trim()
    )
    const controlTypes = checked.filter(Boolean)

    const isOtherChecked = Boolean(document.getElementById("f_type_other_chk")?.checked)
    const controlTypeOther = String(document.getElementById("f_type_other")?.value || "").trim()

    const pressure = String(document.getElementById("f_pressure")?.value || "").trim()
    const devicesCount = String(document.getElementById("f_devices")?.value || "").trim()
    const powerKw = String(document.getElementById("f_power")?.value || "").trim()

    const photosAvailable = String(document.getElementById("f_photos")?.value || "Non").trim()
    const photosLink = String(document.getElementById("f_photos_link")?.value || "").trim()

    const note = String(document.getElementById("f_note")?.value || "").trim()

    return {
      addressControl,
      region,
      chaufferie,

      controlTypes,
      isOtherChecked,
      controlTypeOther,

      pressure,
      devicesCount,
      powerKw,

      photosAvailable,
      photosLink,

      note,
    }
  }

  function validateBookingPayload(p) {
    const errors = []
    if (!p.addressControl || p.addressControl.length < 8) errors.push("Adresse du contrôle : obligatoire.")
    if (!p.controlTypes || !p.controlTypes.length) errors.push("Veuillez sélectionner au moins 1 type de contrôle.")
    if (p.isOtherChecked && (!p.controlTypeOther || p.controlTypeOther.length < 3)) errors.push("Veuillez préciser le type “Autre”.")
    return errors
  }

  function buildSmartPayload(p, user, profile) {
    // payload stored in bookings + requests
    return {
      uid: user.uid,
      email: (user.email || "").toLowerCase(),

      company: String(profile?.company || "").trim(),
      vat: String(profile?.vat || "").trim(),
      phone: String(profile?.phone || "").trim(),
      hqAddress: String(profile?.hqAddress || "").trim(),

      addressControl: p.addressControl,
      region: p.region,
      chaufferie: p.chaufferie,

      controlTypes: p.controlTypes,
      controlTypeOther: p.isOtherChecked ? p.controlTypeOther : "",

      pressure: p.pressure,
      devicesCount: p.devicesCount,
      powerKw: p.powerKw,

      photosAvailable: p.photosAvailable,
      photosLink: p.photosLink,

      note: p.note,
    }
  }

  // =====================================================
  // Booking transaction (Spark-safe) + REQUESTS (Module 5.1)
  // =====================================================
  async function bookMultiSlots(db, user, startDate, slotsCount, smartPayload) {
    // ✅ Module 5.1 — create requests/{requestId} as single source of truth
    // Spark-only + Spark-safe: in transaction, we only read holds (not bookings)
    const FieldValue = firebase.firestore.FieldValue

    const slotStarts = []
    for (let i = 0; i < slotsCount; i++) {
      slotStarts.push(new Date(startDate.getTime() + i * CFG.slotMinutes * 60000))
    }

    const requestId =
      "REQ_" +
      user.uid.slice(0, 6) +
      "_" +
      Date.now() +
      "_" +
      Math.random().toString(16).slice(2, 6)

    const durationMinutes = slotsCount * CFG.slotMinutes
    const endDate = new Date(startDate.getTime() + durationMinutes * 60000)

    const expiresAt = new Date(Date.now() + CFG.holdMinutes * 60000)

    const holdsCol = db.collection("holds")
    const bookingsCol = db.collection("bookings")
    const requestsCol = db.collection("requests")

    await db.runTransaction(async (tx) => {
      // 1) Collision check: holds only (Spark-safe)
      for (const d of slotStarts) {
        const slotId = slotIdFromDate(d)
        const holdRef = holdsCol.doc(slotId)
        const holdSnap = await tx.get(holdRef)

        if (holdSnap.exists) {
          throw new Error("Un des créneaux est en cours de réservation. Merci d’actualiser.")
        }
      }

      // 2) Create holds + bookings (one per slot)
      for (let i = 0; i < slotStarts.length; i++) {
        const d = slotStarts[i]
        const slotId = slotIdFromDate(d)

        const holdRef = holdsCol.doc(slotId)
        const bookingRef = bookingsCol.doc(slotId)

        tx.set(holdRef, {
          uid: user.uid,
          slotId,
          start: firebase.firestore.Timestamp.fromDate(d),
          end: firebase.firestore.Timestamp.fromDate(addMinutesDate(d, CFG.slotMinutes)),
          status: "hold",
          requestId,
          expiresAt: firebase.firestore.Timestamp.fromDate(expiresAt),
          createdAt: FieldValue.serverTimestamp(),
        })

        tx.set(bookingRef, {
          uid: user.uid,
          email: (user.email || "").toLowerCase(),
          slotId,
          start: firebase.firestore.Timestamp.fromDate(d),
          end: firebase.firestore.Timestamp.fromDate(addMinutesDate(d, CFG.slotMinutes)),
          status: "pending",
          requestId,
          slotIndex: i + 1,
          totalSlots: slotsCount,
          ...smartPayload,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
      }

      // 3) Create request (single doc = truth)
      const requestRef = requestsCol.doc(requestId)
      tx.set(requestRef, {
        requestId,
        uid: user.uid,
        email: (user.email || "").toLowerCase(),

        slotIds: slotStarts.map((d) => slotIdFromDate(d)),
        totalSlots: slotsCount,
        durationMinutes,

        start: firebase.firestore.Timestamp.fromDate(startDate),
        end: firebase.firestore.Timestamp.fromDate(endDate),

        status: "pending",

        ...smartPayload,

        outlook: {
          linked: false,
          eventId: null,
          lastSeenAt: null,
        },

        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    })

    return requestId
  }

  // =====================================================
  // "Mes rendez-vous" grouping
  // =====================================================
  function groupBookingsByRequestId(bookings) {
    const map = new Map()
    for (const b of bookings || []) {
      const rid = String(b.requestId || "no_request").trim() || "no_request"
      if (!map.has(rid)) map.set(rid, [])
      map.get(rid).push(b)
    }

    const groups = []
    for (const [rid, items] of map.entries()) {
      items.sort((a, b) => {
        const ta = a.start?.toDate ? a.start.toDate().getTime() : 0
        const tb = b.start?.toDate ? b.start.toDate().getTime() : 0
        return ta - tb
      })
      groups.push({ requestId: rid, items })
    }

    groups.sort((a, b) => {
      const ta = a.items?.[0]?.start?.toDate ? a.items[0].start.toDate().getTime() : 0
      const tb = b.items?.[0]?.start?.toDate ? b.items[0].start.toDate().getTime() : 0
      return tb - ta
    })

    return groups
  }

  function renderMyBookingsList(bookings) {
    const list = document.getElementById("apptList")
    if (!list) return

    if (!bookings || !bookings.length) {
      list.innerHTML = `<div class="muted">Aucune demande.</div>`
      return
    }

    const groups = groupBookingsByRequestId(bookings)

    list.innerHTML = groups
      .slice(0, 40)
      .map((g) => {
        const first = g.items[0]
        const start = first.start?.toDate ? first.start.toDate() : null
        const end = first.end?.toDate ? first.end.toDate() : null

        const when = start
          ? start.toLocaleString("fr-BE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
          : ""

        const rid = escapeHtml(g.requestId)
        const n = g.items.length
        const types = Array.isArray(first.controlTypes) ? first.controlTypes.join(", ") : ""
        const addr = escapeHtml(first.addressControl || "")
        const note = escapeHtml(first.note || "")
        const st = escapeHtml(first.status || "pending")

        return `
          <div class="apptCard">
            <div class="apptTop">
              <div style="font-weight:1000">${escapeHtml(when)} <span class="badge">${escapeHtml(st)}</span></div>
              <div class="tiny">Demande: <b>${rid}</b> • Slots: <b>${n}</b></div>
            </div>
            <div class="tiny muted" style="margin-top:6px">${escapeHtml(types)}</div>
            <div class="tiny" style="margin-top:6px">${addr}</div>
            ${note ? `<div class="tiny muted" style="margin-top:6px">${note}</div>` : ""}
          </div>
        `
      })
      .join("")
  }

  // =====================================================
  // Main booking screen controller
  // =====================================================
  let weekStart = startOfWeekMonday(new Date())
  let selectedStartKey = null
  let selectedKeysSet = new Set()
  let lastSlotStateByKey = new Map()
  let lastMyBookingsThisWeek = []

  async function refreshCalendar(user) {
    const days = makeWeekDays(weekStart)
    const timeRows = buildTimeRows()

    const [publicSlots, holds, myBookings] = await Promise.all([
      fetchPublicSlotsForWeek(days),
      fetchHoldsForWeek(days),
      fetchMyBookingsForWeek(user.uid, days),
    ])

    lastMyBookingsThisWeek = myBookings

    const slotStateByKey = buildSlotStateByKey(days, timeRows, publicSlots, holds, myBookings)
    apply48hRule(slotStateByKey)

    lastSlotStateByKey = slotStateByKey

    // Adjust selection if now invalid
    const slotsCount = computeWantedSlotsCountFromForm()
    const canStill = selectedStartKey ? canSelectRange(slotStateByKey, selectedStartKey, slotsCount) : false
    if (!canStill) {
      selectedStartKey = null
      selectedKeysSet = new Set()
    } else {
      selectedKeysSet = new Set(keysForRange(selectedStartKey, slotsCount))
    }

    renderCalendarGrid(days, timeRows, slotStateByKey, selectedKeysSet)

    // title
    const title = document.getElementById("calTitle")
    if (title) {
      const end = addDays(days[0], CFG.daysToShow - 1)
      title.textContent = `${CFG.weeksToShowLabel} ${dayLabel(days[0])} → ${dayLabel(end)}`
    }

    // sub
    const sub = document.getElementById("calSub")
    if (sub) sub.textContent = computeCalSubLabel()

    // wire clicks
    document.querySelectorAll(".slot").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.getAttribute("data-key")
        if (!key) return

        const slotsCount2 = computeWantedSlotsCountFromForm()
        if (!canSelectRange(lastSlotStateByKey, key, slotsCount2)) {
          showBanner("warn", "Ce créneau (ou un des créneaux suivants) n’est plus disponible.")
          return
        }

        selectedStartKey = key
        selectedKeysSet = new Set(keysForRange(key, slotsCount2))
        hideBanner()
        refreshCalendar(user).catch(console.error)
        updateBookButtonState()
      })
    })

    renderMyBookingsList(myBookings)
    updateBookButtonState()
  }

  function updateBookButtonState() {
    const btn = document.getElementById("btnBook")
    if (!btn) return
    const slotsCount = computeWantedSlotsCountFromForm()
    const ok = selectedStartKey && canSelectRange(lastSlotStateByKey, selectedStartKey, slotsCount)
    btn.disabled = !ok
  }

  function wireFormReactivity(user) {
    // on any form change, recompute slots count label, refresh selection validity
    const ids = [
      "f_address",
      "f_region",
      "f_chaufferie",
      "f_pressure",
      "f_devices",
      "f_power",
      "f_photos",
      "f_photos_link",
      "f_note",
      "f_type_other",
      "f_type_other_chk",
    ]

    ids.forEach((id) => {
      const el = document.getElementById(id)
      if (el) {
        el.addEventListener("input", () => {
          const sub = document.getElementById("calSub")
          if (sub) sub.textContent = computeCalSubLabel()
          updateBookButtonState()
        })
        el.addEventListener("change", () => {
          const sub = document.getElementById("calSub")
          if (sub) sub.textContent = computeCalSubLabel()
          updateBookButtonState()
        })
      }
    })

    document.querySelectorAll("#f_types input[type='checkbox']").forEach((el) => {
      el.addEventListener("change", () => {
        const sub = document.getElementById("calSub")
        if (sub) sub.textContent = computeCalSubLabel()
        // If selection becomes invalid, refresh will clear it
        refreshCalendar(user).catch(console.error)
      })
    })
  }

  async function ensureProfileThenBooking(user) {
    const profile = await loadMyProfile(user.uid)

    if (!profile || !profile.company || !profile.vat || !profile.phone || !profile.hqAddress) {
      renderProfileForm(user.email || "")
      showBanner("warn", "Veuillez compléter votre profil avant de demander un rendez-vous.")

      const btnSave = document.getElementById("btnSaveProfile")
      btnSave?.addEventListener("click", async () => {
        hideBanner()

        const data = {
          company: String(document.getElementById("p_company")?.value || "").trim(),
          vat: String(document.getElementById("p_vat")?.value || "").trim(),
          phone: String(document.getElementById("p_phone")?.value || "").trim(),
          hqAddress: String(document.getElementById("p_hq")?.value || "").trim(),
        }

        const errors = validateProfile(data)
        if (errors.length) {
          showBanner("alert", errors.join(" "))
          return
        }

        try {
          btnSave.disabled = true
          await saveMyProfile(user.uid, data)
          showBanner("ok", "Profil enregistré ✅")
          await ensureProfileThenBooking(user)
        } catch (err) {
          console.error(err)
          if (isProbablyAdblockNetworkError(err)) {
            showBanner("alert", "Erreur réseau (bloqué par une extension ?). Désactivez AdBlock et réessayez.")
          } else {
            showBanner("alert", "Impossible d’enregistrer le profil. Réessayez.")
          }
        } finally {
          btnSave.disabled = false
        }
      })

      return
    }

    renderBookingShell(user.email || "")
    const clientVersionEl = document.getElementById("clientVersion")
    if (clientVersionEl) clientVersionEl.textContent = INDEX_VERSION

    // calendar nav
    document.getElementById("calPrev")?.addEventListener("click", async () => {
      weekStart = addDays(weekStart, -CFG.daysToShow)
      await refreshCalendar(user)
    })
    document.getElementById("calNext")?.addEventListener("click", async () => {
      weekStart = addDays(weekStart, CFG.daysToShow)
      await refreshCalendar(user)
    })
    document.getElementById("calToday")?.addEventListener("click", async () => {
      weekStart = startOfWeekMonday(new Date())
      await refreshCalendar(user)
    })

    wireFormReactivity(user)

    // book
    const btnBook = document.getElementById("btnBook")
    btnBook?.addEventListener("click", async () => {
      hideBanner()

      const slotsCount = computeWantedSlotsCountFromForm()
      if (!selectedStartKey) {
        showBanner("alert", "Veuillez sélectionner un créneau.")
        return
      }
      if (!canSelectRange(lastSlotStateByKey, selectedStartKey, slotsCount)) {
        showBanner("warn", "Ce créneau (ou un des créneaux suivants) n’est plus disponible.")
        return
      }

      const form = readFormPayload()
      const errors = validateBookingPayload(form)
      if (errors.length) {
        showBanner("alert", errors.join(" "))
        return
      }

      const smartPayload = buildSmartPayload(form, user, profile)
      const startDate = parseKeyToDate(selectedStartKey)
      if (!startDate) {
        showBanner("alert", "Date sélectionnée invalide.")
        return
      }

      try {
        btnBook.disabled = true
        const reqId = await bookMultiSlots(db, user, startDate, slotsCount, smartPayload)
        showBanner("ok", `Demande envoyée ✅ (ID: ${reqId})`)
        selectedStartKey = null
        selectedKeysSet = new Set()
        await refreshCalendar(user)
      } catch (err) {
        console.error(err)
        if (isProbablyAdblockNetworkError(err)) {
          showBanner("alert", "Erreur réseau (bloqué par une extension ?). Désactivez AdBlock et réessayez.")
        } else if (String(err?.message || "").includes("en cours de réservation")) {
          showBanner("warn", err.message)
        } else {
          showBanner("alert", "Réservation impossible. Veuillez réessayer.")
        }
      } finally {
        btnBook.disabled = false
      }
    })

    await refreshCalendar(user)
  }

  // =====================================================
  // Top actions
  // =====================================================
  btnLogout.addEventListener("click", async () => {
    try {
      await auth.signOut()
    } catch (e) {
      console.warn("logout err", e)
    }
  })

  // =====================================================
  // Auth state
  // =====================================================
  renderAuth()
  setStatus(false)
  wireAuthHandlers(auth)

  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      setStatus(false)
      __adminChecked = false
      __isAdminCached = false
      renderAuth()
      wireAuthHandlers(auth)
      return
    }

    setStatus(true)

    // admin redirect
    const redirected = await redirectIfAdmin(db, user)
    if (redirected) return

    hideBanner()
    await ensureProfileThenBooking(user)
  })
})