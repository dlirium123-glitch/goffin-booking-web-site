(function () {
  "use strict";

  const root = (window.GoffinBooking = window.GoffinBooking || {});

  function formatMinutes(totalMinutes) {
    const minutes = Number(totalMinutes || 0);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours <= 0) return `${remainingMinutes} min`;
    if (remainingMinutes === 0) return `${hours}h`;
    return `${hours}h${String(remainingMinutes).padStart(2, "0")}`;
  }

  function formatRegion(region) {
    const value = String(region || "").toLowerCase();
    if (value === "bruxelles") return "Bruxelles";
    if (value === "wallonie") return "Wallonie";
    if (value === "flandre") return "Flandre";
    return value;
  }

  function formatServiceSummary(service, catalog) {
    const serviceType = catalog.getServiceTypeById(service?.serviceTypeId);
    const label = serviceType?.label || service?.serviceTypeId || "Service";
    const count = Number(service?.installationsCount || 0);
    return `${label} x ${count}`;
  }

  function formatAddressSummary(addressDraft, catalog) {
    const line = [addressDraft?.addressLine1, addressDraft?.postalCode, addressDraft?.city].filter(Boolean).join(", ");
    const services = Array.isArray(addressDraft?.services)
      ? addressDraft.services.map((service) => formatServiceSummary(service, catalog)).join(" | ")
      : "";
    return [line, services].filter(Boolean).join(" - ");
  }

  root.formatters = {
    formatMinutes,
    formatRegion,
    formatServiceSummary,
    formatAddressSummary,
  };
})();
