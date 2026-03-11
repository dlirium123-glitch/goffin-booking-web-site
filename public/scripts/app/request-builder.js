(function () {
  "use strict";

  const root = (window.GoffinBooking = window.GoffinBooking || {});

  function createDraftState(profile) {
    return {
      profile: {
        contactName: profile?.contactName || "",
        email: profile?.email || "",
        company: profile?.company || "",
        vat: profile?.vat || "",
        phone: profile?.phone || "",
        billingAddress: profile?.billingAddress || profile?.hqAddress || "",
      },
      addresses: [createEmptyAddress()],
      activeAddressIndex: 0,
    };
  }

  function createEmptyAddress() {
    return {
      id: `addr_${Math.random().toString(36).slice(2, 8)}`,
      tempKey: `draft_${Math.random().toString(36).slice(2, 10)}`,
      label: "",
      addressLine1: "",
      postalCode: "",
      city: "",
      region: "",
      country: "BE",
      services: [createEmptyService()],
      serviceMinutes: 0,
      travelMinutes: 30,
      totalDurationMinutes: 30,
      holdId: null,
      holdSlotIds: [],
      selectedSequence: null,
    };
  }

  function createEmptyService() {
    return {
      serviceTypeId: "",
      installationsCount: 1,
      answers: {},
      serviceMinutes: 0,
    };
  }

  function cloneDraft(draft) {
    return {
      profile: { ...(draft.profile || {}) },
      activeAddressIndex: Number(draft.activeAddressIndex || 0),
      addresses: (draft.addresses || []).map((address) => ({
        ...address,
        services: (address.services || []).map((service) => ({
          ...service,
          answers: { ...(service.answers || {}) },
        })),
        holdSlotIds: Array.isArray(address.holdSlotIds) ? address.holdSlotIds.slice() : [],
        selectedSequence: address.selectedSequence
          ? {
              ...address.selectedSequence,
              slotIds: Array.isArray(address.selectedSequence.slotIds) ? address.selectedSequence.slotIds.slice() : [],
              slots: Array.isArray(address.selectedSequence.slots) ? address.selectedSequence.slots.slice() : [],
            }
          : null,
      })),
    };
  }

  function recalculateDraft(draft, catalog, durationEngine) {
    const next = cloneDraft(draft);
    next.addresses = next.addresses.map((address) => {
      const computed = durationEngine.computeAddressDuration(address, catalog, durationEngine.DEFAULT_TRAVEL_MINUTES);
      return {
        ...address,
        services: computed.services,
        serviceMinutes: computed.serviceMinutes,
        travelMinutes: computed.travelMinutes,
        totalDurationMinutes: computed.totalDurationMinutes,
      };
    });
    return next;
  }

  root.requestBuilder = {
    createDraftState,
    createEmptyAddress,
    createEmptyService,
    cloneDraft,
    recalculateDraft,
  };
})();
