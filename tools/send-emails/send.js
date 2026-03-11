/* eslint-disable no-console */
const { Firestore, Timestamp } = require("@google-cloud/firestore")
const nodemailer = require("nodemailer")

function getEnv(name, fallback = null) {
  const value = process.env[name]
  return value == null || value === "" ? fallback : value
}

function requireEnv(name) {
  const value = getEnv(name)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function formatDateTime(value) {
  if (!value) return "-"
  const date = value instanceof Date ? value : value.toDate ? value.toDate() : new Date(value)
  return new Intl.DateTimeFormat("fr-BE", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/Brussels",
  }).format(date)
}

function formatMinutes(value) {
  const minutes = Number(value || 0)
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (!hours) return `${remainder} min`
  if (!remainder) return `${hours} h`
  return `${hours} h ${remainder} min`
}

function resolveRecipient(message) {
  if (typeof message.to === "string" && message.to.includes("@")) return message.to
  return requireEnv("OFFICE_EMAIL")
}

async function createTransporter() {
  const host = requireEnv("SMTP_HOST")
  const port = Number(getEnv("SMTP_PORT", "587"))
  const secure = String(getEnv("SMTP_SECURE", port === 465 ? "true" : "false")).toLowerCase() === "true"
  const user = requireEnv("SMTP_USER")
  const pass = requireEnv("SMTP_PASS")

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  })

  await transporter.verify()
  return transporter
}

async function loadPendingMessages({ db, limit }) {
  const snap = await db.collection("outbox").where("status", "==", "pending").limit(limit).get()
  return snap.docs.map((doc) => ({ id: doc.id, ref: doc.ref, ...doc.data() }))
}

async function loadRequestBundle({ db, requestId }) {
  const [requestSnap, addressesSnap, servicesSnap, appointmentsSnap] = await Promise.all([
    db.collection("requests").doc(requestId).get(),
    db.collection("requestAddresses").where("requestId", "==", requestId).get(),
    db.collection("requestServices").where("requestId", "==", requestId).get(),
    db.collection("appointments").where("requestId", "==", requestId).get(),
  ])

  return {
    request: requestSnap.exists ? { id: requestSnap.id, ...requestSnap.data() } : null,
    addresses: addressesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    services: servicesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    appointments: appointmentsSnap.docs.map((doc) => ({ id: doc.id, ref: doc.ref, ...doc.data() })),
  }
}

function groupServicesByAddress(services) {
  return services.reduce((acc, service) => {
    const key = service.requestAddressId || "unknown"
    if (!acc[key]) acc[key] = []
    acc[key].push(service)
    return acc
  }, {})
}

function groupAppointmentsByAddress(appointments) {
  return appointments.reduce((acc, appointment) => {
    acc[appointment.requestAddressId] = appointment
    return acc
  }, {})
}

function buildTextBody({ message, bundle }) {
  const request = bundle.request || {}
  const servicesByAddress = groupServicesByAddress(bundle.services)
  const appointmentsByAddress = groupAppointmentsByAddress(bundle.appointments)
  const customer = request.customerSnapshot || message.payload?.customer || {}

  const lines = [
    `Nouvelle demande ${request.requestNumber || message.requestId || message.id}`,
    "",
    "Client",
    `- Societe: ${customer.company || "-"}`,
    `- Contact: ${customer.contactName || "-"}`,
    `- Email: ${customer.email || "-"}`,
    `- Telephone: ${customer.phone || "-"}`,
    "",
    `Nombre d'adresses: ${bundle.addresses.length}`,
    "",
  ]

  bundle.addresses.forEach((address, index) => {
    const appointment = appointmentsByAddress[address.id]
    const services = servicesByAddress[address.id] || []
    lines.push(`Adresse ${index + 1}: ${address.label || address.addressLine1 || "-"}`)
    lines.push(`- Adresse: ${address.addressLine1 || "-"}, ${address.postalCode || "-"} ${address.city || "-"}`)
    lines.push(`- Region: ${address.region || "-"}`)
    lines.push(`- Duree: ${formatMinutes(address.totalDurationMinutes)}`)
    lines.push(`- Rendez-vous: ${appointment ? `${formatDateTime(appointment.start)} -> ${formatDateTime(appointment.end)}` : "-"}`)
    lines.push(`- Slots: ${appointment?.slotIds?.join(", ") || "-"}`)
    if (services.length) {
      lines.push("- Techniques:")
      services.forEach((service) => {
        lines.push(`  * ${service.serviceLabelSnapshot || service.serviceCodeSnapshot || service.serviceTypeId} x${service.installationsCount || 0} (${formatMinutes(service.serviceMinutes)})`)
      })
    }
    lines.push("")
  })

  return lines.join("\n").trim()
}

function buildHtmlBody({ message, bundle }) {
  const request = bundle.request || {}
  const servicesByAddress = groupServicesByAddress(bundle.services)
  const appointmentsByAddress = groupAppointmentsByAddress(bundle.appointments)
  const customer = request.customerSnapshot || message.payload?.customer || {}

  const addressBlocks = bundle.addresses.map((address, index) => {
    const appointment = appointmentsByAddress[address.id]
    const services = servicesByAddress[address.id] || []
    const servicesHtml = services.map((service) => `
      <li>
        <strong>${escapeHtml(service.serviceLabelSnapshot || service.serviceCodeSnapshot || service.serviceTypeId)}</strong>
        <span> x${escapeHtml(service.installationsCount || 0)} </span>
        <span>(${escapeHtml(formatMinutes(service.serviceMinutes))})</span>
      </li>
    `).join("")

    return `
      <section style="margin:0 0 24px;padding:16px;border:1px solid #d9e0ea;border-radius:14px;background:#f8fafc;">
        <h3 style="margin:0 0 10px;font-size:16px;">Adresse ${index + 1} · ${escapeHtml(address.label || address.addressLine1 || "-")}</h3>
        <p style="margin:0 0 6px;"><strong>Adresse :</strong> ${escapeHtml(address.addressLine1 || "-")}, ${escapeHtml(address.postalCode || "-")} ${escapeHtml(address.city || "-")}</p>
        <p style="margin:0 0 6px;"><strong>Region :</strong> ${escapeHtml(address.region || "-")}</p>
        <p style="margin:0 0 6px;"><strong>Duree :</strong> ${escapeHtml(formatMinutes(address.totalDurationMinutes))}</p>
        <p style="margin:0 0 6px;"><strong>Rendez-vous :</strong> ${escapeHtml(appointment ? `${formatDateTime(appointment.start)} -> ${formatDateTime(appointment.end)}` : "-")}</p>
        <p style="margin:0 0 12px;"><strong>Slots :</strong> ${escapeHtml(appointment?.slotIds?.join(", ") || "-")}</p>
        <div><strong>Techniques</strong></div>
        <ul style="margin:8px 0 0 18px;padding:0;">${servicesHtml || "<li>Aucune technique</li>"}</ul>
      </section>
    `
  }).join("")

  return `
    <div style="font-family:Segoe UI,Arial,sans-serif;color:#10233d;line-height:1.45;">
      <h1 style="margin:0 0 18px;font-size:22px;">Nouvelle demande ${escapeHtml(request.requestNumber || message.requestId || message.id)}</h1>
      <section style="margin:0 0 24px;padding:16px;border:1px solid #d9e0ea;border-radius:14px;background:#ffffff;">
        <h2 style="margin:0 0 12px;font-size:18px;">Client</h2>
        <p style="margin:0 0 6px;"><strong>Societe :</strong> ${escapeHtml(customer.company || "-")}</p>
        <p style="margin:0 0 6px;"><strong>Contact :</strong> ${escapeHtml(customer.contactName || "-")}</p>
        <p style="margin:0 0 6px;"><strong>Email :</strong> ${escapeHtml(customer.email || "-")}</p>
        <p style="margin:0;"><strong>Telephone :</strong> ${escapeHtml(customer.phone || "-")}</p>
      </section>
      ${addressBlocks || "<p>Aucune adresse detaillee.</p>"}
    </div>
  `.trim()
}

async function markAppointmentsEmailStatus({ db, requestId, status }) {
  const snap = await db.collection("appointments").where("requestId", "==", requestId).get()
  if (snap.empty) return

  for (let index = 0; index < snap.docs.length; index += 400) {
    const batch = db.batch()
    snap.docs.slice(index, index + 400).forEach((doc) => {
      batch.update(doc.ref, {
        officeEmailStatus: status,
        updatedAt: Timestamp.now(),
      })
    })
    await batch.commit()
  }
}

async function markOutbox({ messageRef, status, attempts, error = null }) {
  const now = Timestamp.now()
  const payload = {
    status,
    attempts,
    lastAttemptAt: now,
    updatedAt: now,
    error: error ? String(error).slice(0, 1000) : null,
  }
  if (status === "sent") payload.sentAt = now
  await messageRef.update(payload)
}

async function processMessage({ db, transporter, message, fromEmail }) {
  const recipient = resolveRecipient(message)
  const bundle = await loadRequestBundle({ db, requestId: message.requestId })
  const text = buildTextBody({ message, bundle })
  const html = buildHtmlBody({ message, bundle })

  await transporter.sendMail({
    from: fromEmail,
    to: recipient,
    subject: message.subject || `Nouvelle demande ${message.requestId || message.id}`,
    text,
    html,
  })

  await markOutbox({
    messageRef: message.ref,
    status: "sent",
    attempts: Number(message.attempts || 0) + 1,
  })
  await markAppointmentsEmailStatus({ db, requestId: message.requestId, status: "sent" })
}

async function processFailure({ db, message, error }) {
  await markOutbox({
    messageRef: message.ref,
    status: "failed",
    attempts: Number(message.attempts || 0) + 1,
    error: error?.message || String(error),
  })
  await markAppointmentsEmailStatus({ db, requestId: message.requestId, status: "failed" })
}

async function main() {
  const projectId = requireEnv("FIREBASE_PROJECT_ID")
  const limit = Number(getEnv("EMAIL_BATCH_LIMIT", "20"))
  const fromEmail = requireEnv("SMTP_FROM")
  const db = new Firestore({ projectId })
  const transporter = await createTransporter()

  const messages = await loadPendingMessages({ db, limit })
  if (!messages.length) {
    console.log("No pending outbox messages")
    return
  }

  let sent = 0
  let failed = 0

  for (const message of messages) {
    try {
      await processMessage({ db, transporter, message, fromEmail })
      sent += 1
      console.log("Email sent", { id: message.id, requestId: message.requestId })
    } catch (error) {
      failed += 1
      console.error("Email failed", { id: message.id, requestId: message.requestId, error: error.message })
      await processFailure({ db, message, error })
    }
  }

  console.log("Outbox run complete", { total: messages.length, sent, failed })
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error("Send emails failed", error)
  process.exit(1)
})
