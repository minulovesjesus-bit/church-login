import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

import { resetMockApi } from "@/test/mock-api";

afterEach(() => {
  resetMockApi();
});
