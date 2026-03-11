(function () {
  "use strict";

  const root = (window.GoffinBooking = window.GoffinBooking || {});
  const availability = root.availabilityEngine;
  const formatters = root.formatters;

  function escapeHtml(value) {
    return root.escapeHtml ? root.escapeHtml(value) : String(value);
  }

  function renderWeekCalendar(options) {
    const slots = Array.isArray(options?.slots) ? options.slots : [];
    const requiredMinutes = Number(options?.requiredMinutes || 0);
    const minStartMs = Number(options?.minStartMs || 0);
    const startOfDay = options?.startOfDay;
    const isWeekend = options?.isWeekend;
    const onSelect = options?.onSelect;
    const mount = options?.mount;

    if (!mount || !availability || typeof startOfDay !== "function" || typeof isWeekend !== "function") return;

    const normalizedSlots = slots.map((slot) => availability.normalizeSlot(slot));
    const sequences = availability.buildAdjacentSequences(normalizedSlots, { requiredMinutes, minStartMs });
    const sequenceMap = new Map(sequences.map((sequence) => [sequence.id, sequence]));
    const sequenceStarts = new Set(sequences.map((sequence) => sequence.firstSlot.id));
    const byDay = availability.groupSlotsByDay(normalizedSlots, startOfDay);

    const keys = Array.from(byDay.keys()).sort();
    if (keys.length === 0) {
      mount.innerHTML = '<p class="muted">Aucun créneau public sur cette semaine.</p>';
      return;
    }

    let html = "";
    keys.forEach((dayKey) => {
      const date = new Date(dayKey);
      const label = date.toLocaleDateString(undefined, { weekday: "long", day: "2-digit", month: "2-digit" });
      html += `<div class="dayBlock ${isWeekend(date) ? "weekend" : ""}">
        <div class="dayTitle">${escapeHtml(label)}</div>
        <div class="slots">`;

      byDay.get(dayKey).forEach((slot) => {
        const start = slot.startDate;
        const end = slot.endDate;
        const hhmm = `${pad2(start.getHours())}:${pad2(start.getMinutes())} -> ${pad2(end.getHours())}:${pad2(end.getMinutes())}`;
        const isSequenceStart = sequenceStarts.has(slot.id);
        const busy = slot.status !== "free";
        const tooSoon = start.getTime() < minStartMs;

        html += `
          <button class="slot ${isSequenceStart ? "free" : "busy"} ${tooSoon ? "tooSoon" : ""}"
            data-slotid="${escapeHtml(slot.id)}"
            ${isSequenceStart && !tooSoon ? "" : "disabled"}
            title="${escapeHtml(busy ? "busy" : (tooSoon ? "moins de 48h" : "free"))}">
            ${escapeHtml(hhmm)} • ${escapeHtml(getSlotLabel({ slot, isSequenceStart, tooSoon, requiredMinutes }))}
          </button>
        `;
      });

      html += "</div></div>";
    });

    mount.innerHTML = html;

    mount.querySelectorAll("button.slot.free").forEach((button) => {
      button.addEventListener("click", () => {
        const slotId = button.getAttribute("data-slotid");
        const sequence = sequences.find((item) => item.firstSlot.id === slotId);
        if (sequence && typeof onSelect === "function") onSelect(sequence, sequenceMap);
      });
    });
  }

  function getSlotLabel({ slot, isSequenceStart, tooSoon, requiredMinutes }) {
    if (slot.status !== "free") return "Occupe";
    if (tooSoon) return "Moins de 48h";
    if (!isSequenceStart) return "Sequence insuffisante";
    if (requiredMinutes > Number(slot.durationMinutes || 0)) {
      return `Disponible (${formatters.formatMinutes(requiredMinutes)})`;
    }
    return "Libre";
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  root.slotPicker = {
    renderWeekCalendar,
  };
})();
