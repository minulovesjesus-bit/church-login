import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";

import {
  birthDateParts,
  SegmentedPhoneInput,
} from "@/components/forms/segmented-inputs";

function ControlledPhone({
  initialValue = "",
  onChange = vi.fn(),
}: {
  initialValue?: string;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <SegmentedPhoneInput
      label="학생 연락처"
      name="phone"
      value={value}
      onChange={(nextValue) => {
        setValue(nextValue);
        onChange(nextValue);
      }}
    />
  );
}

it("splits API birth dates into year, month, and day parts", () => {
  expect(birthDateParts("2012-04-03")).toEqual({ year: "2012", month: "04", day: "03" });
  expect(birthDateParts("")).toEqual({ year: "", month: "", day: "" });
});

it("prefills a controlled phone value into fixed segments", () => {
  render(<ControlledPhone initialValue="01012345678" />);

  expect(screen.getByLabelText("학생 연락처 앞자리")).toHaveValue("010");
  expect(screen.getByLabelText("학생 연락처 중간자리")).toHaveValue("1234");
  expect(screen.getByLabelText("학생 연락처 끝자리")).toHaveValue("5678");
  expect(document.querySelector('input[type="hidden"][name="phone"]')).toHaveValue("01012345678");
});

it("joins controlled digit edits and advances focus at each segment boundary", () => {
  const onChange = vi.fn();
  render(<ControlledPhone onChange={onChange} />);

  const first = screen.getByLabelText("학생 연락처 앞자리");
  const middle = screen.getByLabelText("학생 연락처 중간자리");
  const last = screen.getByLabelText("학생 연락처 끝자리");

  first.focus();
  fireEvent.change(first, { target: { value: "01a0" } });
  expect(first).toHaveValue("010");
  expect(middle).toHaveFocus();

  fireEvent.change(middle, { target: { value: "12345" } });
  expect(middle).toHaveValue("1234");
  expect(last).toHaveFocus();

  fireEvent.change(last, { target: { value: "56789" } });
  expect(last).toHaveValue("5678");
  expect(onChange.mock.calls.map(([value]) => value)).toEqual([
    "010",
    "0101234",
    "01012345678",
  ]);
});

it("distributes pasted digits across segments and caps the controlled value at eleven digits", () => {
  const onChange = vi.fn();
  render(<ControlledPhone onChange={onChange} />);

  const first = screen.getByLabelText("학생 연락처 앞자리");
  const middle = screen.getByLabelText("학생 연락처 중간자리");
  const last = screen.getByLabelText("학생 연락처 끝자리");

  fireEvent.paste(first, {
    clipboardData: { getData: () => "010-1234-56789" },
  });

  expect(first).toHaveValue("010");
  expect(middle).toHaveValue("1234");
  expect(last).toHaveValue("5678");
  expect(last).toHaveFocus();
  expect(document.querySelector('input[type="hidden"][name="phone"]')).toHaveValue("01012345678");
  expect(onChange).toHaveBeenCalledWith("01012345678");
});

it("moves focus backward on backspace from an empty controlled segment", () => {
  render(<ControlledPhone initialValue="010" />);

  const first = screen.getByLabelText("학생 연락처 앞자리");
  const middle = screen.getByLabelText("학생 연락처 중간자리");
  middle.focus();
  fireEvent.keyDown(middle, { key: "Backspace" });

  expect(first).toHaveFocus();
});

it("keeps a three-digit final segment editable for ten-digit values", () => {
  render(<ControlledPhone initialValue="0101234567" />);

  const last = screen.getByLabelText("학생 연락처 끝자리");
  expect(last).toHaveValue("567");

  fireEvent.change(last, { target: { value: "5678" } });
  expect(last).toHaveValue("5678");
  expect(document.querySelector('input[type="hidden"][name="phone"]')).toHaveValue("01012345678");
});

it("allows a ten-digit controlled phone to pass form validation and submit", () => {
  const onSubmit = vi.fn();
  render(
    <form
      aria-label="phone form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <ControlledPhone initialValue="0101234567" />
      <button type="submit">저장</button>
    </form>,
  );

  const form = screen.getByRole("form", { name: "phone form" });
  expect(form).toBeValid();

  fireEvent.submit(form);
  expect(onSubmit).toHaveBeenCalledTimes(1);
});
