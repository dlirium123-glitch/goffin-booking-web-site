(function () {
  "use strict";

  const root = (window.GoffinBooking = window.GoffinBooking || {});

  function timestampToDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === "function") return value.toDate();
    return null;
  }

  function getSlotDurationMinutes(slot) {
    const start = timestampToDate(slot?.start);
    const end = timestampToDate(slot?.end);
    if (!start || !end) return 0;
    return Math.round((end.getTime() - start.getTime()) / 60000);
  }

  function normalizeSlot(slot) {
    const startDate = timestampToDate(slot?.start);
    const endDate = timestampToDate(slot?.end);
    return {
      ...slot,
      startDate,
      endDate,
      durationMinutes: getSlotDurationMinutes(slot),
      status: String(slot?.status || "").toLowerCase(),
    };
  }

  function isSlotReservable(slot, options) {
    const normalized = normalizeSlot(slot);
    const minStartMs = Number(options?.minStartMs || 0);
    return normalized.status === "free" && normalized.startDate && normalized.startDate.getTime() >= minStartMs;
  }

  function areSlotsAdjacent(leftSlot, rightSlot) {
    const leftEnd = leftSlot?.endDate?.getTime?.();
    const rightStart = rightSlot?.startDate?.getTime?.();
    return Number.isFinite(leftEnd) && Number.isFinite(rightStart) && leftEnd === rightStart;
  }

  function collectReservableSlots(slots, options) {
    return (Array.isArray(slots) ? slots : [])
      .map(normalizeSlot)
      .filter((slot) => isSlotReservable(slot, options))
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  }

  function buildAdjacentSequences(slots, options) {
    const requiredMinutes = Number(options?.requiredMinutes || 0);
    const reservable = collectReservableSlots(slots, options);
    const sequences = [];

    for (let startIndex = 0; startIndex < reservable.length; startIndex++) {
      const sequenceSlots = [reservable[startIndex]];
      let totalMinutes = reservable[startIndex].durationMinutes;

      if (totalMinutes >= requiredMinutes) {
        sequences.push(makeSequence(sequenceSlots));
      }

      for (let nextIndex = startIndex + 1; nextIndex < reservable.length; nextIndex++) {
        const previous = sequenceSlots[sequenceSlots.length - 1];
        const candidate = reservable[nextIndex];
        if (!areSlotsAdjacent(previous, candidate)) break;

        sequenceSlots.push(candidate);
        totalMinutes += candidate.durationMinutes;

        if (totalMinutes >= requiredMinutes) {
          sequences.push(makeSequence(sequenceSlots));
        }
      }
    }

    return dedupeSequences(sequences);
  }

  function makeSequence(slots) {
    const first = slots[0];
    const last = slots[slots.length - 1];
    return {
      id: slots.map((slot) => slot.id).join("__"),
      slotIds: slots.map((slot) => slot.id),
      slots: slots.slice(),
      startDate: first.startDate,
      endDate: last.endDate,
      totalMinutes: slots.reduce((sum, slot) => sum + Number(slot.durationMinutes || 0), 0),
      firstSlot: first,
      lastSlot: last,
    };
  }

  function dedupeSequences(sequences) {
    const seen = new Set();
    return sequences.filter((sequence) => {
      if (seen.has(sequence.id)) return false;
      seen.add(sequence.id);
      return true;
    });
  }

  function groupSlotsByDay(slots, startOfDay) {
    const byDay = new Map();
    (Array.isArray(slots) ? slots : []).forEach((slot) => {
      const date = slot.startDate || timestampToDate(slot.start);
      if (!date) return;
      const key = startOfDay(date).toISOString();
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(normalizeSlot(slot));
    });
    return byDay;
  }

  root.availabilityEngine = {
    timestampToDate,
    getSlotDurationMinutes,
    normalizeSlot,
    isSlotReservable,
    areSlotsAdjacent,
    collectReservableSlots,
    buildAdjacentSequences,
    groupSlotsByDay,
  };
})();
