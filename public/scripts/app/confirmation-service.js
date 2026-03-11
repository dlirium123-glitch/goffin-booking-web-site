(function () {
  "use strict";

  const root = (window.GoffinBooking = window.GoffinBooking || {});

  function buildRequestId(userId) {
    return `req_${Date.now()}_${String(userId || "").slice(0, 6)}`;
  }

  function buildDocId(prefix, seed) {
    return `${prefix}_${String(seed || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40)}`;
  }

  function buildOutboxPayload({ requestId, draft }) {
    return {
      requestId,
      addressCount: draft.addresses.length,
      customer: {
        contactName: draft.profile.contactName,
        company: draft.profile.company,
        email: draft.profile.email,
        phone: draft.profile.phone,
      },
      addresses: draft.addresses.map((address) => ({
        label: address.label || address.addressLine1,
        city: address.city,
        postalCode: address.postalCode,
        slotIds: address.selectedSequence?.slotIds || [],
      })),
    };
  }

  async function confirmDraft({ db, auth, refs, draft, serviceCatalog, slotMinutes }) {
    const user = auth.currentUser;
    if (!user) throw new Error("Utilisateur non connecte.");

    const collections = refs(db);
    const requestId = buildRequestId(user.uid);
    const nowServer = firebase.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();

    batch.set(collections.requests.doc(requestId), {
      requestNumber: requestId.toUpperCase(),
      uid: user.uid,
      status: "pending",
      customerSnapshot: {
        email: draft.profile.email,
        company: draft.profile.company,
        vat: draft.profile.vat,
        phone: draft.profile.phone,
        contactName: draft.profile.contactName,
      },
      totalAddresses: draft.addresses.length,
      totalAppointments: draft.addresses.length,
      notes: "",
      createdAt: nowServer,
      updatedAt: nowServer,
    }, { merge: false });

    for (const address of draft.addresses) {
      const requestAddressId = buildDocId("reqaddr", `${requestId}_${address.tempKey}`);
      const appointmentId = buildDocId("appt", `${requestId}_${address.tempKey}`);

      batch.set(collections.requestAddresses.doc(requestAddressId), {
        requestId,
        uid: user.uid,
        label: address.label || "",
        addressLine1: address.addressLine1,
        addressLine2: "",
        postalCode: address.postalCode,
        city: address.city,
        region: address.region,
        country: address.country || "BE",
        warningFlags: root.validation.detectAddressWarnings(address, serviceCatalog),
        status: "pending",
        selectedAppointmentId: appointmentId,
        serviceMinutes: address.serviceMinutes,
        travelMinutes: address.travelMinutes,
        totalDurationMinutes: address.totalDurationMinutes,
        createdAt: nowServer,
        updatedAt: nowServer,
      }, { merge: false });

      for (const [serviceIndex, service] of (address.services || []).entries()) {
        const serviceType = serviceCatalog.getServiceTypeById(service.serviceTypeId);
        const requestServiceId = buildDocId("reqsvc", `${requestAddressId}_${serviceIndex}`);
        batch.set(collections.requestServices.doc(requestServiceId), {
          requestId,
          requestAddressId,
          uid: user.uid,
          serviceTypeId: service.serviceTypeId,
          serviceCodeSnapshot: serviceType?.code || service.serviceTypeId,
          serviceLabelSnapshot: serviceType?.label || service.serviceTypeId,
          installationsCount: Number(service.installationsCount || 0),
          serviceMinutes: Number(service.serviceMinutes || 0),
          answers: service.answers || {},
          createdAt: nowServer,
          updatedAt: nowServer,
        }, { merge: false });
      }

      batch.set(collections.appointments.doc(appointmentId), {
        requestId,
        requestAddressId,
        uid: user.uid,
        status: "pending",
        slotIds: address.selectedSequence.slotIds.slice(),
        holdId: address.holdId,
        start: firebase.firestore.Timestamp.fromDate(address.selectedSequence.startDate),
        end: firebase.firestore.Timestamp.fromDate(address.selectedSequence.endDate),
        serviceMinutes: address.serviceMinutes,
        travelMinutes: address.travelMinutes,
        totalDurationMinutes: address.totalDurationMinutes,
        officeEmailStatus: "pending",
        outlookStatus: "not_created",
        outlookReference: null,
        createdAt: nowServer,
        updatedAt: nowServer,
      }, { merge: false });

      for (const slotId of address.selectedSequence.slotIds) {
        const slotDate = root.dateFromSlotId(slotId);
        if (!slotDate) continue;
        const slotEnd = new Date(slotDate.getTime() + slotMinutes * 60000);
        batch.set(collections.bookings.doc(slotId), {
          slotId,
          appointmentId,
          requestId,
          holdId: address.holdId,
          status: "pending",
          start: firebase.firestore.Timestamp.fromDate(slotDate),
          end: firebase.firestore.Timestamp.fromDate(slotEnd),
          createdAt: nowServer,
          updatedAt: nowServer,
        }, { merge: false });
      }
    }

    const outboxId = buildDocId("outbox", requestId);
    batch.set(collections.outbox.doc(outboxId), {
      type: "new_request",
      status: "pending",
      to: "office",
      subject: `Nouvelle demande ${requestId.toUpperCase()}`,
      requestId,
      uid: user.uid,
      payload: buildOutboxPayload({ requestId, draft }),
      attempts: 0,
      lastAttemptAt: null,
      sentAt: null,
      error: null,
      createdAt: nowServer,
      updatedAt: nowServer,
    }, { merge: false });

    await batch.commit();

    const cleanupBatch = db.batch();
    for (const address of draft.addresses) {
      (address.holdSlotIds || []).forEach((slotId) => cleanupBatch.delete(collections.holdSlots.doc(slotId)));
      if (address.holdId) cleanupBatch.delete(collections.holds.doc(address.holdId));
    }
    await cleanupBatch.commit();

    return { requestId };
  }

  root.confirmationService = {
    confirmDraft,
  };
})();
