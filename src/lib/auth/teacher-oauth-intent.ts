import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const TEACHER_OAUTH_INTENT_COOKIE = "teacher_oauth_intent";
export const TEACHER_OAUTH_INTENT_TTL_SECONDS = 300;

const TEACHER_DESTINATION = "/teacher";
const MINIMUM_SECRET_BYTES = 32;

type IntentOptions = {
  nowSeconds?: number;
  nonce?: string;
};

type TeacherOAuthIntentPayload = {
  destination: typeof TEACHER_DESTINATION;
  expires_at: number;
  issued_at: number;
  nonce: string;
};

function requireStrongSecret(secret: string): void {
  if (Buffer.byteLength(secret, "utf8") < MINIMUM_SECRET_BYTES) {
    throw new Error("TEACHER_OAUTH_INTENT_SECRET must be at least 32 bytes.");
  }
}

function signature(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function currentTimeSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function createTeacherOAuthIntent(
  secret: string,
  options: IntentOptions = {},
): string {
  requireStrongSecret(secret);
  const issuedAt = options.nowSeconds ?? currentTimeSeconds();
  const payload: TeacherOAuthIntentPayload = {
    destination: TEACHER_DESTINATION,
    expires_at: issuedAt + TEACHER_OAUTH_INTENT_TTL_SECONDS,
    issued_at: issuedAt,
    nonce: options.nonce ?? randomBytes(24).toString("base64url"),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${encodedPayload}.${signature(encodedPayload, secret)}`;
}

export function verifyTeacherOAuthIntent(
  intent: string,
  secret: string,
  options: Pick<IntentOptions, "nowSeconds"> = {},
): typeof TEACHER_DESTINATION | undefined {
  try {
    requireStrongSecret(secret);
    const parts = intent.split(".");
    if (parts.length !== 2) return undefined;
    const [encodedPayload, suppliedSignature] = parts;
    const expectedSignature = signature(encodedPayload, secret);
    const suppliedBytes = Buffer.from(suppliedSignature, "utf8");
    const expectedBytes = Buffer.from(expectedSignature, "utf8");
    if (
      suppliedBytes.length !== expectedBytes.length ||
      !timingSafeEqual(suppliedBytes, expectedBytes)
    ) {
      return undefined;
    }

    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<TeacherOAuthIntentPayload>;
    const now = options.nowSeconds ?? currentTimeSeconds();
    if (
      payload.destination !== TEACHER_DESTINATION ||
      !Number.isInteger(payload.issued_at) ||
      !Number.isInteger(payload.expires_at) ||
      typeof payload.nonce !== "string" ||
      payload.nonce.length < 16 ||
      Number(payload.issued_at) > now ||
      Number(payload.expires_at) <= now ||
      Number(payload.expires_at) - Number(payload.issued_at) !==
        TEACHER_OAUTH_INTENT_TTL_SECONDS
    ) {
      return undefined;
    }
    return TEACHER_DESTINATION;
  } catch {
    return undefined;
  }
}
