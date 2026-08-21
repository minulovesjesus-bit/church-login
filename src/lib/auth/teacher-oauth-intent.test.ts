import { expect, it } from "vitest";

import {
  createTeacherOAuthIntent,
  verifyTeacherOAuthIntent,
} from "./teacher-oauth-intent";

const secret = "teacher-oauth-test-secret-at-least-32-bytes";


it("signs only the teacher destination for a short-lived window", () => {
  const intent = createTeacherOAuthIntent(secret, {
    nowSeconds: 1_000,
    nonce: "fixed-test-nonce",
  });

  expect(verifyTeacherOAuthIntent(intent, secret, { nowSeconds: 1_299 })).toBe(
    "/teacher",
  );
  expect(verifyTeacherOAuthIntent(intent, secret, { nowSeconds: 1_301 })).toBeUndefined();
});

it("rejects tampering and a different server secret", () => {
  const intent = createTeacherOAuthIntent(secret, {
    nowSeconds: 1_000,
    nonce: "fixed-test-nonce",
  });
  const tampered = `${intent.slice(0, -1)}${intent.endsWith("a") ? "b" : "a"}`;

  expect(verifyTeacherOAuthIntent(tampered, secret, { nowSeconds: 1_001 })).toBeUndefined();
  expect(
    verifyTeacherOAuthIntent(
      intent,
      "different-teacher-oauth-secret-at-least-32-bytes",
      { nowSeconds: 1_001 },
    ),
  ).toBeUndefined();
});

it("refuses a weak server secret", () => {
  expect(() =>
    createTeacherOAuthIntent("too-short", {
      nowSeconds: 1_000,
      nonce: "fixed-test-nonce",
    }),
  ).toThrow("TEACHER_OAUTH_INTENT_SECRET");
});
