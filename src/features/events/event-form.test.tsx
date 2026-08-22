import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => {
  class TestApiClientError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }

  return {
    api: { post: vi.fn(), patch: vi.fn() },
    ApiClientError: TestApiClientError,
  };
});

vi.mock("@/lib/api/client", () => client);

import EventForm, {
  isoInstantToSeoulLocal,
  seoulLocalToIsoInstant,
  type EventSeries,
} from "./event-form";

const recurringEvent: EventSeries = {
  id: "00000000-0000-4000-8000-000000000301",
  title: "주일예배",
  description: "함께 예배드려요",
  location: "본당",
  starts_at: "2026-08-23T02:00:00Z",
  ends_at: "2026-08-23T03:30:00Z",
  repeat_weekly: true,
  repeat_until: "2026-12-27",
  created_by: "00000000-0000-4000-8000-000000000201",
  created_at: "2026-08-21T00:00:00Z",
  updated_at: "2026-08-21T00:00:00Z",
};

function fillRequiredFields(overrides: Partial<Record<"title" | "starts" | "ends", string>> = {}) {
  fireEvent.change(screen.getByLabelText("제목"), {
    target: { value: overrides.title ?? "주일예배" },
  });
  fireEvent.change(screen.getByLabelText("시작"), {
    target: { value: overrides.starts ?? "2026-08-23T11:00" },
  });
  fireEvent.change(screen.getByLabelText("종료"), {
    target: { value: overrides.ends ?? "2026-08-23T12:30" },
  });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "일정 저장" }));
}

afterEach(() => {
  client.api.post.mockReset();
  client.api.patch.mockReset();
});

it("submits a weekly event with Seoul instants and an optional inclusive end date", async () => {
  client.api.post.mockResolvedValue(recurringEvent);
  const onSaved = vi.fn();
  render(<EventForm onSaved={onSaved} />);

  fillRequiredFields();
  fireEvent.change(screen.getByLabelText("설명"), { target: { value: "함께 예배드려요" } });
  fireEvent.change(screen.getByLabelText("장소"), { target: { value: "본당" } });
  fireEvent.click(screen.getByLabelText("매주 반복"));
  fireEvent.change(screen.getByLabelText("반복 종료일"), { target: { value: "2026-12-27" } });
  submit();

  await vi.waitFor(() => expect(client.api.post).toHaveBeenCalledWith(
    "/api/teacher/events",
    {
      title: "주일예배",
      description: "함께 예배드려요",
      location: "본당",
      starts_at: "2026-08-23T02:00:00.000Z",
      ends_at: "2026-08-23T03:30:00.000Z",
      repeat_weekly: true,
      repeat_until: "2026-12-27",
    },
  ));
  expect(onSaved).toHaveBeenCalledWith("created");
});

it("supports indefinite weekly events and forces one-time repeat_until to null", async () => {
  client.api.post.mockResolvedValue(recurringEvent);
  const view = render(<EventForm />);
  fillRequiredFields();
  fireEvent.click(screen.getByLabelText("매주 반복"));
  submit();

  await vi.waitFor(() => expect(client.api.post).toHaveBeenLastCalledWith(
    "/api/teacher/events",
    expect.objectContaining({ repeat_weekly: true, repeat_until: null }),
  ));
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "일정 저장" })).toBeEnabled());

  view.unmount();
  client.api.post.mockClear();
  render(<EventForm />);
  fillRequiredFields({ title: "일회 일정" });
  expect(screen.getByLabelText("반복 종료일")).toBeDisabled();
  submit();

  await vi.waitFor(() => expect(client.api.post).toHaveBeenCalledWith(
    "/api/teacher/events",
    expect.objectContaining({ repeat_weekly: false, repeat_until: null }),
  ));
});

it("clears and disables the repeat end when recurrence is turned off", () => {
  render(<EventForm />);
  const repeatUntil = screen.getByLabelText("반복 종료일") as HTMLInputElement;

  fireEvent.click(screen.getByLabelText("매주 반복"));
  fireEvent.change(repeatUntil, { target: { value: "2026-12-27" } });
  expect(repeatUntil).toHaveValue("2026-12-27");

  fireEvent.click(screen.getByLabelText("매주 반복"));
  expect(repeatUntil).toBeDisabled();
  expect(repeatUntil).toHaveValue("");
});

it("groups recurrence controls under a named fieldset with a 44px weekly target", () => {
  render(<EventForm />);

  const recurrence = screen.getByRole("group", { name: "반복 설정" });
  const weekly = within(recurrence).getByLabelText("매주 반복");
  const weeklyTarget = weekly.closest("label");

  expect(within(recurrence).getByLabelText("반복 종료일")).toBeDisabled();
  expect(weeklyTarget).toHaveClass("min-h-11");
});

it("converts Seoul local values and edit instants independently of the machine timezone", () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    expect(seoulLocalToIsoInstant("2026-08-23T11:00")).toBe("2026-08-23T02:00:00.000Z");
    expect(isoInstantToSeoulLocal("2026-08-23T02:00:00Z")).toBe("2026-08-23T11:00");

    render(<EventForm event={recurringEvent} />);
    expect(screen.getByLabelText("시작")).toHaveValue("2026-08-23T11:00");
    expect(screen.getByLabelText("종료")).toHaveValue("2026-08-23T12:30");
  } finally {
    process.env.TZ = originalTimezone;
  }
});

it("uses historical Asia/Seoul offsets in both conversion directions", () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    expect(seoulLocalToIsoInstant("1960-01-01T12:00")).toBe("1960-01-01T03:30:00.000Z");
    expect(isoInstantToSeoulLocal("1960-01-01T03:30:00Z")).toBe("1960-01-01T12:00");
  } finally {
    process.env.TZ = originalTimezone;
  }
});

it("rejects Seoul local times in a historical clock gap or repeated clock fold", () => {
  expect(seoulLocalToIsoInstant("1960-05-01T00:30")).toBeNull();
  expect(seoulLocalToIsoInstant("1960-09-17T23:30")).toBeNull();
});

describe("calendar and duration validation", () => {
  it.each([
    ["2026-02-30T11:00", "2026-03-01T12:00", "존재하는 시작 날짜와 시간을 입력해 주세요."],
    ["2026-08-23T11:00", "2026-08-23T11:00", "종료 시간은 시작 시간보다 늦어야 합니다."],
    ["2026-08-23T11:00", "2026-08-23T10:59", "종료 시간은 시작 시간보다 늦어야 합니다."],
    ["2026-08-23T11:00", "2026-08-30T11:01", "일정 기간은 7일을 넘을 수 없습니다."],
  ])("rejects invalid range %s - %s", async (starts, ends, message) => {
    render(<EventForm />);
    fillRequiredFields({ starts, ends });
    submit();

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(client.api.post).not.toHaveBeenCalled();
  });
});

it.each([
  ["제목", "   ", "제목을 입력해 주세요."],
  ["제목", "가".repeat(121), "제목은 120자 이하로 입력해 주세요."],
  ["설명", "가".repeat(2001), "설명은 2000자 이하로 입력해 주세요."],
  ["장소", "가".repeat(201), "장소는 200자 이하로 입력해 주세요."],
])("shows Korean field validation for the %s bound", async (label, value, message) => {
  render(<EventForm />);
  fillRequiredFields();
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  submit();

  expect(await screen.findByText(message)).toBeInTheDocument();
  expect(client.api.post).not.toHaveBeenCalled();
});

it("rejects a weekly repeat end before the first Seoul occurrence date", async () => {
  render(<EventForm />);
  fillRequiredFields();
  fireEvent.click(screen.getByLabelText("매주 반복"));
  fireEvent.change(screen.getByLabelText("반복 종료일"), { target: { value: "2026-08-22" } });
  submit();

  expect(await screen.findByText("반복 종료일은 첫 일정 날짜보다 빠를 수 없습니다.")).toBeInTheDocument();
  expect(client.api.post).not.toHaveBeenCalled();
});

it("prefills every field, warns about whole-series editing, and sends an exact PATCH body", async () => {
  client.api.patch.mockResolvedValue({ ...recurringEvent, title: "수정 주일예배" });
  render(<EventForm event={recurringEvent} />);

  expect(screen.getByLabelText("제목")).toHaveValue("주일예배");
  expect(screen.getByLabelText("설명")).toHaveValue("함께 예배드려요");
  expect(screen.getByLabelText("장소")).toHaveValue("본당");
  expect(screen.getByLabelText("매주 반복")).toBeChecked();
  expect(screen.getByLabelText("반복 종료일")).toHaveValue("2026-12-27");
  expect(screen.getByText("반복 일정 전체가 변경됩니다.")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("제목"), { target: { value: "  수정 주일예배  " } });
  submit();

  await vi.waitFor(() => expect(client.api.patch).toHaveBeenCalledWith(
    `/api/teacher/events/${recurringEvent.id}`,
    {
      title: "수정 주일예배",
      description: "함께 예배드려요",
      location: "본당",
      starts_at: "2026-08-23T02:00:00.000Z",
      ends_at: "2026-08-23T03:30:00.000Z",
      repeat_weekly: true,
      repeat_until: "2026-12-27",
    },
  ));
});

it("shows a safe update failure, keeps edit values, and restores controls", async () => {
  client.api.patch.mockRejectedValue(
    new client.ApiClientError("VALIDATION_ERROR", "일정 시간을 다시 확인해 주세요."),
  );
  render(<EventForm event={recurringEvent} />);
  fireEvent.change(screen.getByLabelText("제목"), { target: { value: "보존할 수정값" } });
  submit();

  expect(await screen.findByRole("alert")).toHaveTextContent("일정 시간을 다시 확인해 주세요.");
  expect(screen.getByLabelText("제목")).toHaveValue("보존할 수정값");
  expect(screen.getByRole("button", { name: "일정 저장" })).toBeEnabled();
});

it("prevents duplicate mutations while a request is in flight", async () => {
  let resolveCreate: (value: EventSeries) => void = () => undefined;
  client.api.post.mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve; }));
  render(<EventForm />);
  fillRequiredFields();

  submit();
  await vi.waitFor(() => expect(client.api.post).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "저장 중…" }));
  expect(client.api.post).toHaveBeenCalledTimes(1);

  resolveCreate(recurringEvent);
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "일정 저장" })).toBeEnabled());
});
