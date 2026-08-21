import Link from "next/link";

const SEOUL = "Asia/Seoul";
const MIN_BACKEND_YEAR = 1;
const MAX_BACKEND_YEAR = 9999;

type CalendarDate = { year: number; month: number; day: number };
export type WeekSearchValue = string | string[] | undefined;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

function parseCalendarDate(value: string): CalendarDate | undefined {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!matched) return undefined;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (year < MIN_BACKEND_YEAR || year > MAX_BACKEND_YEAR || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined;
  return { year, month, day };
}

function dayOfWeek({ year, month, day }: CalendarDate): number {
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const adjustedYear = month < 3 ? year - 1 : year;
  return (adjustedYear + Math.floor(adjustedYear / 4) - Math.floor(adjustedYear / 100) + Math.floor(adjustedYear / 400) + offsets[month - 1] + day) % 7;
}

function formatCalendarDate({ year, month, day }: CalendarDate): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addCalendarDays(date: CalendarDate, amount: number): CalendarDate {
  const result = { ...date };
  for (let remaining = Math.abs(amount); remaining > 0; remaining -= 1) {
    if (amount > 0) {
      result.day += 1;
      if (result.day > daysInMonth(result.year, result.month)) {
        result.day = 1;
        result.month += 1;
        if (result.month > 12) {
          result.month = 1;
          result.year += 1;
        }
      }
    } else {
      result.day -= 1;
      if (result.day < 1) {
        result.month -= 1;
        if (result.month < 1) {
          result.month = 12;
          result.year -= 1;
        }
        result.day = daysInMonth(result.year, result.month);
      }
    }
  }
  return result;
}

function isBackendCompatibleWeek(date: CalendarDate): boolean {
  if (date.year < MIN_BACKEND_YEAR || date.year > MAX_BACKEND_YEAR || dayOfWeek(date) !== 1) return false;
  const exclusiveEnd = addCalendarDays(date, 7);
  return exclusiveEnd.year >= MIN_BACKEND_YEAR && exclusiveEnd.year <= MAX_BACKEND_YEAR;
}

function seoulCalendarDate(now: Date): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SEOUL,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function currentSeoulMonday(now = new Date()): string {
  const today = seoulCalendarDate(now);
  return formatCalendarDate(addCalendarDays(today, -((dayOfWeek(today) + 6) % 7)));
}

export function resolveSeoulMonday(value: WeekSearchValue, now = new Date()): string {
  if (typeof value === "string") {
    const parsed = parseCalendarDate(value);
    if (parsed && isBackendCompatibleWeek(parsed)) return value;
  }
  return currentSeoulMonday(now);
}

export function exclusiveSeoulWeekEnd(week: string): string | undefined {
  const parsed = parseCalendarDate(week);
  if (!parsed || !isBackendCompatibleWeek(parsed)) return undefined;
  return formatCalendarDate(addCalendarDays(parsed, 7));
}

export function adjacentSeoulWeek(week: string, offset: -1 | 1): string | undefined {
  const parsed = parseCalendarDate(week);
  if (!parsed || !isBackendCompatibleWeek(parsed)) return undefined;
  const adjacent = addCalendarDays(parsed, offset * 7);
  if (!isBackendCompatibleWeek(adjacent)) return undefined;
  return formatCalendarDate(adjacent);
}

export function WeekNavigation({ week, currentWeek = currentSeoulMonday() }: { week: string; currentWeek?: string }) {
  const previousWeek = adjacentSeoulWeek(week, -1);
  const nextWeek = adjacentSeoulWeek(week, 1);

  return (
    <nav className="event-week-navigation" aria-label="주간 일정 탐색">
      {previousWeek ? <Link className="secondary-button" href={`/student/events?week=${previousWeek}`}>이전 주</Link> : <button className="secondary-button" type="button" disabled>이전 주</button>}
      <Link className="secondary-button" href={`/student/events?week=${currentWeek}`}>이번 주</Link>
      {nextWeek ? <Link className="secondary-button" href={`/student/events?week=${nextWeek}`}>다음 주</Link> : <button className="secondary-button" type="button" disabled>다음 주</button>}
    </nav>
  );
}
