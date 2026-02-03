export const EST_TZ_OFFSET_MIN = -180;
const resolveUtcMs = (dateUtc) => {
if (!dateUtc) return NaN;
const ms = dateUtc instanceof Date ? dateUtc.getTime() : new Date(dateUtc).getTime();
return Number.isFinite(ms) ? ms : NaN;
};

// Convert a UTC instant to local minutes-of-day using a fixed offset (UTC-3).
export const minutesOfDayInTZ = (dateUtc, tzOffsetMin = EST_TZ_OFFSET_MIN) => {
const utcMs = resolveUtcMs(dateUtc);
if (!Number.isFinite(utcMs)) return null;
const localMs = utcMs + tzOffsetMin * 60_000;
const local = new Date(localMs);
return local.getUTCHours() * 60 + local.getUTCMinutes();
};

// Day-of-week (0..6) for a UTC instant in a fixed-offset local time.
export const weekDayIndexInTZ = (dateUtc, tzOffsetMin = EST_TZ_OFFSET_MIN) => {
const utcMs = resolveUtcMs(dateUtc);
if (!Number.isFinite(utcMs)) return null;
const localMs = utcMs + tzOffsetMin * 60_000;
const local = new Date(localMs);
return local.getUTCDay();
};

// Create a UTC Date from a local Y-M-D H:M using a fixed offset (UTC = local - offset).
export const makeUtcFromLocalYMDHM = (year, month, day, hour, minute, tzOffsetMin = EST_TZ_OFFSET_MIN) => {
const utcMs = Date.UTC(year, month - 1, day, hour, minute) - tzOffsetMin * 60_000;
return new Date(utcMs);
};

