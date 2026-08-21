const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

const TIME_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "numeric",
  minute: "2-digit",
});

export function formatSeoulDateTime(value: string): string {
  return DATE_TIME_FORMATTER.format(new Date(value));
}

export function formatSeoulTime(value: string): string {
  return TIME_FORMATTER.format(new Date(value));
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "기록 없음";
  const roundedMinutes = Math.round(seconds / 60);
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  if (hours === 0) return `${minutes}분`;
  if (minutes === 0) return `${hours}시간`;
  return `${hours}시간 ${minutes}분`;
}

export function seoulLocalInputToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (hour > 23 || minute > 59) return null;
  const utcMilliseconds = Date.UTC(year, month - 1, day, hour - 9, minute);
  const seoulCheck = new Date(utcMilliseconds + 9 * 60 * 60 * 1000);
  if (
    seoulCheck.getUTCFullYear() !== year
    || seoulCheck.getUTCMonth() !== month - 1
    || seoulCheck.getUTCDate() !== day
    || seoulCheck.getUTCHours() !== hour
    || seoulCheck.getUTCMinutes() !== minute
  ) {
    return null;
  }
  return new Date(utcMilliseconds).toISOString();
}
