/**
 * Utilitaires partagés pour les scripts Node (outlook-sync, slot-generator).
 * Format slotId = YYYYMMDD_HHMM
 */

function pad2(n) {
  return String(n).padStart(2, "0");
}

function slotIdFromDate(d) {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return `${yyyy}${mm}${dd}_${hh}${mi}`;
}

function dateFromSlotId(slotId) {
  const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})$/.exec(String(slotId || ""));
  if (!m) return null;
  const yy = Number(m[1]);
  const mo = Number(m[2]);
  const dd = Number(m[3]);
  const hh = Number(m[4]);
  const mi = Number(m[5]);
  const date = new Date(yy, mo - 1, dd, hh, mi, 0, 0);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function addMinutes(d, minutes) {
  return new Date(d.getTime() + minutes * 60000);
}

function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function addLocalDays(d, days) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 0, 0, 0, 0);
}

function isWeekend(d) {
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

module.exports = {
  pad2,
  slotIdFromDate,
  dateFromSlotId,
  addMinutes,
  startOfLocalDay,
  addLocalDays,
  isWeekend,
};
