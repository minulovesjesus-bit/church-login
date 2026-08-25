# 교회 출결 시스템 Vercel 배포 작업 계획

> **에이전트 작업 지침:** 이 문서를 실행할 때는 `superpowers:executing-plans`를 사용해 체크박스를 순서대로 처리한다. 실제 운영 데이터베이스에는 E2E fixture나 `supabase db reset`을 실행하지 않는다.

**목표:** 현재 검증된 Next.js + FastAPI + Supabase 교회 출결 시스템을 Vercel Preview에서 검증한 뒤 Production으로 안전하게 배포한다.

**구성:** Next.js와 `api/index.py`의 FastAPI ASGI 앱은 하나의 Vercel 프로젝트에 배포한다. 인증과 PostgreSQL은 기존 Supabase 프로젝트 `nlqcxzwfmdgctidvoyvv`를 사용하고, FastAPI는 Supabase Transaction Pooler로 연결한다.

**기술 스택:** Next.js 16, React 19, Node.js 24, FastAPI, Python 3.12, Supabase Auth/PostgreSQL, Vercel Python Runtime, Fluid Compute

**기준 문서:** `README.md`, `docs/local-development.md`, `.env.example`, `vercel.json`

## 현재 상태

- [x] 기능 기준 커밋: `c24123e feat: complete unified attendance and kiosk flows`
- [x] 프론트엔드 단위 테스트: 332개 통과
- [x] 백엔드 테스트: 468개 통과
- [x] Playwright E2E: 21개 통과
- [x] TypeScript, ESLint, Ruff, Next.js production build 통과
- [x] 로컬 Supabase lint 및 advisor 이상 없음
- [x] 로컬과 원격 Supabase migration 9개 일치
- [ ] 현재 셸의 Node.js를 `v23.11.0`에서 `v24.x`로 전환
- [ ] 현재 `uv 0.9.17`을 `0.9.25` 이상으로 업그레이드
- [ ] Vercel 프로젝트 생성 또는 연결
- [ ] Vercel Preview/Production 환경변수 등록
- [ ] Supabase Auth 운영 URL 등록
- [ ] Preview 검증 후 Production 배포

## 1. 로컬 배포 도구 준비

- [ ] Node.js 버전을 확인하고 반드시 24.x 셸에서 진행한다.

```bash
node --version
```

기대 결과: `v24.x.x`

- [ ] `uv`를 업그레이드하고 버전을 확인한다.

```bash
uv self update
uv --version
```

기대 결과: `uv 0.9.25` 이상

- [ ] 고정된 의존성을 깨끗하게 설치한다.

```bash
npm_config_engine_strict=true npm ci
uv sync
```

## 2. 배포 전 전체 검증

- [ ] 로컬 Supabase와 Docker가 실행 중인지 확인한다.

```bash
npx supabase status
```

- [ ] 아래 검증 명령을 모두 통과시킨다.

```bash
local_db_url=$(npx supabase status -o env | sed -n 's/^DB_URL="\(.*\)"$/\1/p')
local_api_url=$(npx supabase status -o env | sed -n 's/^API_URL="\(.*\)"$/\1/p')
case "$local_db_url" in
  postgresql://postgres:postgres@127.0.0.1:*) ;;
  *) echo "로컬 테스트 DB가 아니므로 중단합니다." >&2; exit 1 ;;
esac
case "$local_api_url" in
  http://127.0.0.1:*) ;;
  *) echo "로컬 Supabase API가 아니므로 중단합니다." >&2; exit 1 ;;
esac

git diff --check
npm test
APP_ENV=test \
SUPABASE_URL="$local_api_url" \
NEXT_PUBLIC_SUPABASE_URL="$local_api_url" \
TEST_DATABASE_URL="$local_db_url" \
DATABASE_URL="$local_db_url" \
uv run pytest tests/backend -q
uv run ruff check backend api tests/backend
npm run typecheck
npm run lint
npm run build
APP_ENV=test npx playwright test
npm run verify:vercel-python
npx supabase db lint --local --schema app --level warning --fail-on warning
npx supabase db advisors --local --type all --level warn --fail-on warn
npm audit --omit=dev
npm audit --audit-level=critical
```

- [ ] `npm run verify:vercel-python` 결과에서 FastAPI 출력, Python handler, `api/index.py`, `backend/main.py` 번들 포함을 확인한다.
- [ ] 실제 운영 Supabase URL이나 `DATABASE_URL`을 E2E 테스트에 전달하지 않았는지 다시 확인한다.

## 3. Supabase 운영 상태 확인

- [ ] 원격 migration 상태를 확인한다.

```bash
npx supabase migration list --linked
```

현재는 아래 9개가 로컬/원격 모두 일치한다.

```text
20260821042256
20260821090703
20260821092122
20260821102113
20260821150727
20260821171326
20260821193853
20260822143631
20260824152000
```

- [ ] 새 migration이 생긴 경우에만 내용을 검토한 뒤 `npx supabase db push`를 실행한다.
- [ ] 운영 DB에서는 `npx supabase db reset`, fixture seed, 테스트 사용자 생성 스크립트를 절대 실행하지 않는다.

## 4. Vercel 프로젝트 연결

- [ ] Vercel Dashboard에서 GitHub 저장소 `minulovesjesus-bit/church-login`을 Import한다.
- [ ] Root Directory는 저장소 루트 `.`로 설정한다.
- [ ] Framework Preset은 Next.js 자동 감지를 사용한다.
- [ ] 별도의 Output Directory를 지정하지 않는다.
- [ ] `vercel.json`의 Fluid Compute와 `api/index.py` Python Function 설정이 적용되는지 확인한다.
- [ ] CLI를 사용할 경우 현재 디렉터리를 프로젝트에 연결한다.

```bash
npx vercel link
npx vercel project inspect
```

연결 후 `.vercel/project.json`은 로컬 설정으로 유지하며 Git에 추가하지 않는다.

## 5. Vercel 환경변수 등록

Vercel Dashboard의 Project → Settings → Environment Variables에서 등록한다. `.env.local` 파일 자체를 업로드하거나 커밋하지 않는다.

### 공개 가능한 브라우저 설정

- [ ] `NEXT_PUBLIC_SUPABASE_URL=https://nlqcxzwfmdgctidvoyvv.supabase.co`
- [ ] `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Supabase Dashboard의 활성 publishable key

### FastAPI 및 Supabase 서버 설정

- [ ] `APP_ENV=production`
- [ ] `SUPABASE_URL=https://nlqcxzwfmdgctidvoyvv.supabase.co`
- [ ] `SUPABASE_PUBLISHABLE_KEY`: 위 publishable key와 동일한 활성 키
- [ ] `SUPABASE_JWT_AUDIENCE=authenticated`
- [ ] `SUPABASE_JWKS_URL=https://nlqcxzwfmdgctidvoyvv.supabase.co/auth/v1/.well-known/jwks.json`
- [ ] `DATABASE_URL`: Supabase Dashboard → Connect → Transaction pooler의 `:6543` URI
- [ ] `DATABASE_CONNECT_TIMEOUT_SECONDS=2`
- [ ] `DATABASE_STATEMENT_TIMEOUT_MS=5000`
- [ ] `APP_TIMEZONE=Asia/Seoul`

`DATABASE_URL`에는 실제 비밀번호를 넣고 SSL이 활성화된 URI를 사용한다. 이 값은 `NEXT_PUBLIC_` 접두사를 사용하지 않는다.

### 관리자 및 키오스크 서버 전용 설정

- [ ] `INITIAL_ADMIN_EMAILS=codeyoma@gmail.com`: 여러 명이면 쉼표로 구분
- [ ] `KIOSK_PASSWORD_HASH`: 현재 운영에 사용할 고정 비밀번호의 Argon2id hash
- [ ] `KIOSK_COOKIE_SECRET`: 최소 32바이트의 독립적인 랜덤 값
- [ ] `QR_SIGNING_SECRET`: `KIOSK_COOKIE_SECRET`과 다른 최소 32바이트 랜덤 값

필요하면 아래 명령으로 새 값을 생성하고 결과는 Vercel Dashboard에만 입력한다.

```bash
uv run python -c 'from argon2 import PasswordHasher; from getpass import getpass; print(PasswordHasher().hash(getpass("Kiosk password: ")))'
openssl rand -base64 48
openssl rand -base64 48
```

### 운영 Origin 설정

- [ ] Vercel의 Production Domain을 확정하고 `PRODUCTION_ORIGIN`으로 기록한다.

```bash
export PRODUCTION_ORIGIN="https://Vercel에서-확정한-운영-도메인"
```

- [ ] Production 환경의 `ALLOWED_FRONTEND_ORIGINS`를 `$PRODUCTION_ORIGIN` 한 개로 설정한다.
- [ ] Preview 환경은 Vercel의 고정 branch alias를 확인하고 그 정확한 origin을 `ALLOWED_FRONTEND_ORIGINS`로 설정한 뒤 재배포한다.
- [ ] `FASTAPI_ORIGIN`은 운영 환경에 등록하지 않는다. 운영에서는 동일 Vercel 프로젝트의 `/api`가 FastAPI Function으로 라우팅된다.
- [ ] `KIOSK_INSECURE_LOCAL_COOKIES`는 등록하지 않거나 `false`로 설정한다.

## 6. Supabase Auth와 Google OAuth 운영 URL 설정

- [ ] Supabase Dashboard → Authentication → URL Configuration에서 Site URL을 `$PRODUCTION_ORIGIN`으로 변경한다.
- [ ] Redirect URLs에 `$PRODUCTION_ORIGIN/auth/callback`을 등록한다.
- [ ] Preview OAuth 검증이 필요하면 Vercel branch alias의 `/auth/callback`을 별도로 등록한다.
- [ ] Google Auth Platform의 Authorized JavaScript origins에 `$PRODUCTION_ORIGIN`을 등록한다.
- [ ] Google Auth Platform의 Authorized redirect URIs에 아래 Supabase callback이 등록되어 있는지 확인한다.

```text
https://nlqcxzwfmdgctidvoyvv.supabase.co/auth/v1/callback
```

- [ ] Supabase Google Provider의 Client ID/Client Secret이 운영 Google OAuth Client와 일치하는지 확인한다.
- [ ] 학생 이메일 인증 메일이 운영 도메인의 `/auth/callback?next=/auth/continue`로 돌아오는지 확인한다.

## 7. Preview 배포

- [ ] Git 연동 Preview가 자동 생성되지 않으면 CLI로 Preview를 생성한다.

```bash
PREVIEW_URL=$(npx vercel)
export PREVIEW_URL
```

- [ ] Preview 상태와 로그를 확인한다.

```bash
npx vercel ls
npx vercel inspect "$PREVIEW_URL"
npx vercel logs "$PREVIEW_URL"
```

- [ ] Preview에서 다음 HTTP 상태를 확인한다.

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' "$PREVIEW_URL/"
curl -fsS -o /dev/null -w '%{http_code}\n' "$PREVIEW_URL/api/health"
curl -fsS -o /dev/null -w '%{http_code}\n' "$PREVIEW_URL/qr"
```

기대 결과: 모두 `200`

## 8. Preview 수동 기능 검증

- [ ] 학생 이메일 회원가입 → 이메일 확인 → 로그인 → 온보딩 완료
- [ ] Google OAuth 로그인 후 올바른 운영 도메인으로 복귀
- [ ] `codeyoma@gmail.com` 계정이 교사이면서 admin 권한을 유지
- [ ] 학생 홈, 출결 통계, 주간 반복 이벤트 표시
- [ ] 학생 개인정보 수정 및 로그아웃 후 뒤로 가기로 보호 화면이 복구되지 않음
- [ ] 관리자 학생 목록에서 학생 수정, 통계 포함/제외, 교사 승격
- [ ] 교사 대시보드와 학생 화면 전환
- [ ] `/qr`에서 기기 이름과 관리자 비밀번호로 키오스크 세션 생성
- [ ] 실제 휴대폰 카메라 권한을 허용하고 QR 스캔
- [ ] QR 스캔이 `입실 → 퇴실 → 입실 → 퇴실`로 반복
- [ ] QR이 20초마다 갱신되고 만료된 QR이 거부됨
- [ ] 관리자 키오스크 목록에 기기 이름이 표시됨
- [ ] 키오스크 세션 삭제 후 해당 기기가 `/qr` 잠금 화면으로 복귀
- [ ] 모바일, 태블릿, 데스크톱에서 하단 navigation과 주요 dialog 확인

## 9. Production 배포

- [ ] Preview 검증 결과와 배포 commit을 기록한다.
- [ ] 검증된 Preview artifact를 Production으로 승격한다.

```bash
npx vercel promote "$PREVIEW_URL"
```

Git production branch 배포 정책을 사용할 경우에는 검증된 feature branch를 production branch에 병합해 배포한다. Preview에서 검증한 것과 다른 commit을 직접 Production으로 배포하지 않는다.

- [ ] Production URL에서 `/`, `/api/health`, `/login`, `/qr`를 다시 확인한다.
- [ ] Google OAuth, 학생 이메일 인증, 실제 QR 출결을 Production에서 한 번씩 확인한다.
- [ ] Vercel Runtime Logs에서 5xx, Python import 오류, DB timeout, CORS 오류가 없는지 확인한다.

```bash
npx vercel logs "$PRODUCTION_ORIGIN"
```

## 10. 장애 대응과 롤백

- [ ] 직전 정상 deployment URL과 commit hash를 기록한다.
- [ ] 심각한 오류가 있으면 새 코드를 덧대기 전에 정상 deployment로 롤백한다.

```bash
npx vercel rollback
```

- [ ] OAuth 오류는 Supabase Site URL, Redirect URLs, Google JavaScript origin, Supabase callback URI를 순서대로 확인한다.
- [ ] DB 연결 오류는 `DATABASE_URL`이 Transaction pooler `:6543`인지, 비밀번호와 SSL 설정이 맞는지 확인한다.
- [ ] 키오스크 쿠키 오류는 HTTPS, `ALLOWED_FRONTEND_ORIGINS`, `KIOSK_COOKIE_SECRET`을 확인한다.
- [ ] 롤백은 Vercel application artifact만 되돌린다. 이미 적용된 Supabase migration은 임의로 삭제하거나 되돌리지 않는다.

## 11. 운영 전 최종 확인

- [ ] `.env.local`, DB 비밀번호, Google Client Secret, kiosk/QR secret이 Git에 포함되지 않음
- [ ] Vercel Production 환경변수 변경 후 새 deployment를 생성함
- [ ] Supabase migration 9개가 계속 일치함
- [ ] Production health check와 핵심 기능 smoke test 통과
- [ ] Vercel Hobby 사용 조건이 실제 교회 운영 용도에 적합한지 확인함
- [ ] 무료 플랜 한도 초과, Supabase 일시 중지, 이메일 발송 한도에 대한 운영 담당자 대응 방법을 기록함

## 공식 참고 문서

- Vercel Python Runtime: https://vercel.com/docs/functions/runtimes/python
- Vercel FastAPI: https://vercel.com/docs/frameworks/backend/fastapi
- Vercel Environment Variables: https://vercel.com/docs/environment-variables
- Vercel Deployments: https://vercel.com/docs/deployments/overview
- Vercel Hobby Plan: https://vercel.com/docs/plans/hobby
- Supabase Redirect URLs: https://supabase.com/docs/guides/auth/redirect-urls
- Supabase Google Login: https://supabase.com/docs/guides/auth/social-login/auth-google
- Supabase Database Connections: https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase Database Migrations: https://supabase.com/docs/guides/deployment/database-migrations

## 완료 기준

다음 조건을 모두 만족하면 배포 완료로 판단한다.

1. Production의 `/api/health`가 `200`을 반환한다.
2. 학생 이메일 가입과 Google OAuth가 운영 도메인으로 정상 복귀한다.
3. 실제 카메라 QR 출결이 DB와 교사 대시보드에 반영된다.
4. 키오스크 세션 삭제와 학생/교사/admin 권한 흐름이 정상 동작한다.
5. Vercel Runtime Logs에 반복되는 5xx 또는 DB/CORS/Auth 오류가 없다.
6. 배포 commit, Production URL, 환경변수 등록 담당자, 롤백 대상 deployment가 기록되어 있다.
