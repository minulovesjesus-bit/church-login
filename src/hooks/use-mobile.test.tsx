import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useIsMobile } from "./use-mobile";

let desktopMatches = true;
let listeners: Set<EventListener>;
let matchMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  desktopMatches = true;
  listeners = new Set();
  matchMedia = vi.fn((query: string) => ({
    media: query,
    get matches() {
      return desktopMatches;
    },
    onchange: null,
    addEventListener: (_type: string, listener: EventListener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: EventListener) => listeners.delete(listener),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  vi.stubGlobal("matchMedia", matchMedia);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("switches mobile state at the exact 64rem desktop boundary", () => {
  const { result } = renderHook(() => useIsMobile());

  expect(matchMedia).toHaveBeenCalledWith("(min-width: 64rem)");
  expect(result.current).toBe(false);

  act(() => {
    desktopMatches = false;
    listeners.forEach((listener) => listener(new Event("change")));
  });

  expect(result.current).toBe(true);
});
