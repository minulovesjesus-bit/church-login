import { vi } from "vitest";

const createApiSpy = () => vi.fn();

export const mockApi = {
  get: createApiSpy(),
  post: createApiSpy(),
  patch: createApiSpy(),
  delete: createApiSpy(),
};

export function resetMockApi(): void {
  Object.values(mockApi).forEach((spy) => spy.mockReset());
}
