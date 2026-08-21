const SEOUL = "Asia/Seoul";
const LOCAL_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const OFFSET_AWARE_PATTERN = /(Z|[+-]\d{2}:\d{2})$/i;
const HOUR_MILLISECONDS = 60 * 60 * 1000;

type CalendarDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const SEOUL_PARTS_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: SEOUL,
  calendar: "gregory",
  numberingSystem: "latn",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const SEOUL_DISPLAY_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: SEOUL,
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
  hour: "numeric",
  minute: "2-digit",
});

function utcMilliseconds(parts: CalendarDateTime): number {
  const instant = new Date(0);
  instant.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  instant.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return instant.getTime();
}

function parseLocalDateTime(value: string): CalendarDateTime | null {
  const match = LOCAL_DATETIME_PATTERN.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const parts = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    second: 0,
  };
  if (
    parts.year < 1
    || parts.year > 9999
    || parts.month < 1
    || parts.month > 12
    || parts.hour > 23
    || parts.minute > 59
  ) {
    return null;
  }
  const roundTrip = new Date(utcMilliseconds(parts));
  if (
    roundTrip.getUTCFullYear() !== parts.year
    || roundTrip.getUTCMonth() !== parts.month - 1
    || roundTrip.getUTCDate() !== parts.day
    || roundTrip.getUTCHours() !== parts.hour
    || roundTrip.getUTCMinutes() !== parts.minute
  ) {
    return null;
  }
  return parts;
}

function seoulParts(instant: Date): CalendarDateTime | null {
  if (Number.isNaN(instant.getTime())) return null;
  const formatted = SEOUL_PARTS_FORMATTER.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(
    formatted.find((item) => item.type === type)?.value,
  );
  const result = {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
  return Object.values(result).every(Number.isFinite) ? result : null;
}

function sameMinute(left: CalendarDateTime, right: CalendarDateTime): boolean {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute
    && right.second === 0;
}

function offsetAt(instantMilliseconds: number): number | null {
  const parts = seoulParts(new Date(instantMilliseconds));
  return parts ? utcMilliseconds(parts) - instantMilliseconds : null;
}

export function seoulLocalToIsoInstant(value: string): string | null {
  const local = parseLocalDateTime(value);
  if (!local) return null;
  const wallClockMilliseconds = utcMilliseconds(local);
  const offsets = new Set<number>();
  for (let hour = -36; hour <= 36; hour += 1) {
    const probe = wallClockMilliseconds + hour * HOUR_MILLISECONDS;
    const offset = offsetAt(probe);
    if (offset !== null) offsets.add(offset);
  }

  const matches = new Set<number>();
  offsets.forEach((offset) => {
    const candidate = wallClockMilliseconds - offset;
    const roundTrip = seoulParts(new Date(candidate));
    if (roundTrip && sameMinute(local, roundTrip)) matches.add(candidate);
  });
  if (matches.size !== 1) return null;
  const [instant] = matches;
  const date = new Date(instant);
  if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return null;
  return date.toISOString();
}

export function isoInstantToSeoulLocal(value: string): string {
  if (!OFFSET_AWARE_PATTERN.test(value)) return "";
  const parts = seoulParts(new Date(value));
  if (!parts || parts.year < 1 || parts.year > 9999) return "";
  const year = String(parts.year).padStart(4, "0");
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  const hour = String(parts.hour).padStart(2, "0");
  const minute = String(parts.minute).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function formatSeoulDateTime(value: string): string {
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? "" : SEOUL_DISPLAY_FORMATTER.format(instant);
}
