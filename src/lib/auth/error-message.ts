export type AuthErrorLike = {
  code?: string | null;
  message?: string | null;
};

export type AuthIssue = {
  message: string;
  field?: "email" | "password";
};

const KOREAN_TEXT = /[\u3131-\uD79D]/;

export function authIssue(
  error: AuthErrorLike | null | undefined,
  action: "login" | "signup" | "oauth",
): AuthIssue | undefined {
  if (!error) return undefined;

  switch (error.code) {
    case "invalid_credentials":
      return { message: "이메일 또는 비밀번호를 확인해 주세요." };
    case "email_not_confirmed":
      return { message: "이메일 인증을 완료한 뒤 다시 로그인해 주세요.", field: "email" };
    case "user_already_exists":
    case "email_exists":
    case "user_already_registered":
      return { message: "이미 가입된 이메일입니다. 로그인해 주세요.", field: "email" };
    case "weak_password":
      return { message: "비밀번호는 8자 이상 입력해 주세요.", field: "password" };
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return { message: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." };
  }

  if (error.message && KOREAN_TEXT.test(error.message)) {
    return { message: error.message };
  }

  if (action === "signup") {
    return { message: "회원가입을 완료하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요." };
  }
  if (action === "oauth") {
    return { message: "Google 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  return { message: "로그인 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요." };
}
