"use client";

import {
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";

import { Input } from "@/components/ui/input";

const digitsOnly = (value: string) => value.replace(/\D/g, "");

export type BirthDateParts = {
  year: string;
  month: string;
  day: string;
};

export function birthDateParts(value: string): BirthDateParts {
  const digits = digitsOnly(value).slice(0, 8);
  return {
    year: digits.slice(0, 4),
    month: digits.slice(4, 6),
    day: digits.slice(6, 8),
  };
}

type SegmentedBirthDateInputProps = {
  value: BirthDateParts;
  onChange: (value: BirthDateParts) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
};

export function birthDateValue({ year, month, day }: BirthDateParts) {
  return year.length === 4 && month.length === 2 && day.length === 2
    ? `${year}-${month}-${day}`
    : "";
}

export function SegmentedBirthDateInput({
  value,
  onChange,
  disabled,
  invalid,
  describedBy,
}: SegmentedBirthDateInputProps) {
  const monthRef = useRef<HTMLInputElement>(null);
  const dayRef = useRef<HTMLInputElement>(null);

  function update(part: keyof BirthDateParts, rawValue: string, maximum: number) {
    const nextValue = digitsOnly(rawValue).slice(0, maximum);
    onChange({ ...value, [part]: nextValue });
    if (nextValue.length !== maximum) return;
    if (part === "year") monthRef.current?.focus();
    if (part === "month") dayRef.current?.focus();
  }

  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2">
      <Input
        aria-label="생년"
        value={value.year}
        onChange={(event) => update("year", event.target.value, 4)}
        inputMode="numeric"
        autoComplete="bday-year"
        placeholder="생년"
        maxLength={4}
        minLength={4}
        pattern="[0-9]{4}"
        aria-invalid={invalid}
        aria-describedby={describedBy}
        disabled={disabled}
        required
      />
      <Input
        ref={monthRef}
        aria-label="월"
        value={value.month}
        onChange={(event) => update("month", event.target.value, 2)}
        inputMode="numeric"
        autoComplete="bday-month"
        placeholder="월"
        maxLength={2}
        minLength={2}
        pattern="[0-9]{2}"
        aria-invalid={invalid}
        aria-describedby={describedBy}
        disabled={disabled}
        required
      />
      <Input
        ref={dayRef}
        aria-label="일"
        value={value.day}
        onChange={(event) => update("day", event.target.value, 2)}
        inputMode="numeric"
        autoComplete="bday-day"
        placeholder="일"
        maxLength={2}
        minLength={2}
        pattern="[0-9]{2}"
        aria-invalid={invalid}
        aria-describedby={describedBy}
        disabled={disabled}
        required
      />
      <input type="hidden" name="birth_date" value={birthDateValue(value)} />
    </div>
  );
}

type PhoneParts = [string, string, string];

type SegmentedPhoneInputProps = {
  label: string;
  name: string;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  autoComplete?: string;
};

const PHONE_LENGTHS = [3, 4, 4] as const;

function phoneParts(value: string): PhoneParts {
  const digits = digitsOnly(value).slice(0, 11);
  return [digits.slice(0, 3), digits.slice(3, 7), digits.slice(7, 11)];
}

export function SegmentedPhoneInput({
  label,
  name,
  value,
  onChange,
  disabled,
  invalid,
  describedBy,
  autoComplete,
}: SegmentedPhoneInputProps) {
  const [internalParts, setInternalParts] = useState<PhoneParts>(["", "", ""]);
  const controlled = value !== undefined;
  const parts = controlled ? phoneParts(value) : internalParts;
  const refs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  function commit(nextParts: PhoneParts) {
    if (!controlled) setInternalParts(nextParts);
    onChange?.(nextParts.join("").slice(0, 11));
  }

  function update(index: number, event: ChangeEvent<HTMLInputElement>) {
    const nextPart = digitsOnly(event.target.value).slice(0, PHONE_LENGTHS[index]);
    const nextParts = parts.map((part, partIndex) => (
      partIndex === index ? nextPart : part
    )) as PhoneParts;
    commit(nextParts);
    if (nextPart.length === PHONE_LENGTHS[index]) refs[index + 1]?.current?.focus();
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !parts[index] && index > 0) {
      refs[index - 1].current?.focus();
    }
  }

  function handlePaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    const pasted = digitsOnly(event.clipboardData.getData("text")).slice(0, 11);
    event.preventDefault();
    const next = [...parts] as PhoneParts;
    if (pasted.length <= PHONE_LENGTHS[index]) {
      next[index] = pasted;
      commit(next);
      if (pasted.length === PHONE_LENGTHS[index]) refs[index + 1]?.current?.focus();
      return;
    }
    let offset = 0;
    for (let partIndex = index; partIndex < PHONE_LENGTHS.length; partIndex += 1) {
      const length = PHONE_LENGTHS[partIndex];
      next[partIndex] = pasted.slice(offset, offset + length);
      offset += length;
    }
    commit(next);
    let finalFilledIndex = index;
    for (let partIndex = index; partIndex < next.length; partIndex += 1) {
      if (next[partIndex]) finalFilledIndex = partIndex;
    }
    refs[finalFilledIndex]?.current?.focus();
  }

  const segmentLabels = ["앞자리", "중간자리", "끝자리"];

  return (
    <div className="grid grid-cols-[minmax(0,3fr)_auto_minmax(0,4fr)_auto_minmax(0,4fr)] items-center gap-2">
      {parts.map((part, index) => (
        <div key={segmentLabels[index]} className="contents">
          {index > 0 ? <span aria-hidden className="text-muted-foreground">-</span> : null}
          <Input
            ref={refs[index]}
            aria-label={`${label} ${segmentLabels[index]}`}
            value={part}
            onChange={(event) => update(index, event)}
            onKeyDown={(event) => handleKeyDown(index, event)}
            onPaste={(event) => handlePaste(index, event)}
            type="tel"
            inputMode="numeric"
            autoComplete={index === 0 ? autoComplete : "off"}
            maxLength={PHONE_LENGTHS[index]}
            minLength={index === 2 ? 3 : PHONE_LENGTHS[index]}
            pattern={index === 2 ? "[0-9]{3,4}" : `[0-9]{${PHONE_LENGTHS[index]}}`}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            disabled={disabled}
            required
          />
        </div>
      ))}
      <input type="hidden" name={name} value={parts.join("")} />
    </div>
  );
}
