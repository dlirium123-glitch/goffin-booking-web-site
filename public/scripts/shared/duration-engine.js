(function () {
  "use strict";

  const root = (window.GoffinBooking = window.GoffinBooking || {});

  function normalizeInstallationsCount(value) {
    const count = Number(value);
    if (!Number.isFinite(count) || count < 1) return 0;
    return Math.floor(count);
  }

  function computeServiceMinutes(service, serviceType) {
    const units = normalizeInstallationsCount(service?.installationsCount);
    const baseMinutes = Number(serviceType?.baseMinutesPerUnit || 0);
    return units * baseMinutes;
  }

  function computeAddressDuration(addressDraft, catalog, travelMinutes) {
    const items = Array.isArray(addressDraft?.services) ? addressDraft.services : [];
    const computedServices = items.map((service) => {
      const serviceType = catalog.getServiceTypeById(service.serviceTypeId);
      const serviceMinutes = computeServiceMinutes(service, serviceType);
      return {
        ...service,
        serviceMinutes,
      };
    });

    const serviceMinutes = computedServices.reduce((sum, service) => sum + Number(service.serviceMinutes || 0), 0);
    const safeTravelMinutes = Number.isFinite(Number(travelMinutes)) ? Number(travelMinutes) : 30;

    return {
      services: computedServices,
      serviceMinutes,
      travelMinutes: safeTravelMinutes,
      totalDurationMinutes: serviceMinutes + safeTravelMinutes,
    };
  }

  root.durationEngine = {
    DEFAULT_TRAVEL_MINUTES: 30,
    normalizeInstallationsCount,
    computeServiceMinutes,
    computeAddressDuration,
  };
})();
