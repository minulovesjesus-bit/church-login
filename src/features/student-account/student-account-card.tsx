"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api, ApiClientError } from "@/lib/api/client";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

import { StudentProfileForm } from "./student-profile-form";
import type { EditableStudentProfile, StudentProfile } from "./types";

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function StudentAccountCard({ email }: { email: string }) {
  const router = useRouter();
  const [profile, setProfile] = useState<StudentProfile>();
  const [loadError, setLoadError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [editPending, setEditPending] = useState(false);
  const [editError, setEditError] = useState<string>();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState<string>();
  const saveInFlight = useRef(false);
  const logoutInFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    api.get<StudentProfile>("/api/students/profile", { signal: controller.signal })
      .then((nextProfile) => {
        if (!active) return;
        setProfile(nextProfile);
        setLoadError(undefined);
      })
      .catch((caught: unknown) => {
        if (!active || isAbortError(caught)) return;
        if (caught instanceof ApiClientError && caught.code === "AUTH_REQUIRED") {
          router.replace("/login");
          return;
        }
        if (caught instanceof ApiClientError && caught.code === "PROFILE_REQUIRED") {
          router.replace("/onboarding");
          return;
        }
        setLoadError(errorMessage(caught, "내 정보를 불러오지 못했습니다."));
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt, router]);

  function retry() {
    setLoadError(undefined);
    setProfile(undefined);
    setAttempt((current) => current + 1);
  }

  function openEdit() {
    if (!profile || logoutPending) return;
    setEditError(undefined);
    setEditOpen(true);
  }

  function closeEdit() {
    if (editPending) return;
    setEditError(undefined);
    setEditOpen(false);
  }

  async function saveProfile(editableProfile: EditableStudentProfile) {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    setEditPending(true);
    setEditError(undefined);
    try {
      const saved = await api.patch<StudentProfile>("/api/students/profile", editableProfile);
      setProfile(saved);
      setEditOpen(false);
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === "AUTH_REQUIRED") {
        router.replace("/login");
        return;
      }
      if (caught instanceof ApiClientError && caught.code === "PROFILE_REQUIRED") {
        router.replace("/onboarding");
        return;
      }
      setEditError(errorMessage(caught, "저장하지 못했습니다. 다시 시도해 주세요."));
    } finally {
      saveInFlight.current = false;
      setEditPending(false);
    }
  }

  function openLogout() {
    if (!profile || logoutPending) return;
    setLogoutError(undefined);
    setLogoutOpen(true);
  }

  function changeLogoutOpen(open: boolean) {
    if (!open && logoutPending) return;
    if (!open) setLogoutError(undefined);
    setLogoutOpen(open);
  }

  async function confirmLogout(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (logoutInFlight.current) return;
    logoutInFlight.current = true;
    setLogoutPending(true);
    setLogoutError(undefined);
    try {
      const { error } = await createBrowserSupabaseClient().auth.signOut({ scope: "local" });
      if (error) {
        setLogoutError("로그아웃하지 못했습니다. 다시 시도해 주세요.");
        return;
      }
      setLogoutOpen(false);
      router.replace("/login");
    } catch {
      setLogoutError("로그아웃하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      logoutInFlight.current = false;
      setLogoutPending(false);
    }
  }

  return (
    <Card className="student-account-card">
      <CardHeader>
        <CardTitle><h2>내 정보</h2></CardTitle>
        <CardDescription>{email}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="student-account-card__teacher-help">
          교사 권한이 필요하면 관리자에게 이 계정 이메일을 알려 주세요. 기존 학생 정보와 출결 기록은 유지됩니다.
        </p>
        {loadError ? (
          <div className="flex flex-col gap-3">
            <Alert variant="destructive">
              <AlertTitle>내 정보를 불러오지 못했습니다.</AlertTitle>
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
            <Button type="button" variant="outline" onClick={retry}>다시 시도</Button>
          </div>
        ) : !profile ? (
          <div className="flex flex-col gap-3" role="status">
            <span className="sr-only">내 정보를 불러오고 있습니다.</span>
            <Skeleton className="h-6 w-2/5" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <dl className="flex flex-col gap-2">
            <div className="flex justify-between gap-4"><dt>이름</dt><dd>{profile.name}</dd></div>
            <div className="flex justify-between gap-4"><dt>생년월일</dt><dd>{profile.birth_date}</dd></div>
            <div className="flex justify-between gap-4"><dt>학생 연락처</dt><dd>{profile.phone}</dd></div>
            <div className="flex justify-between gap-4"><dt>보호자 연락처</dt><dd>{profile.guardian_phone}</dd></div>
          </dl>
        )}
      </CardContent>
      {profile ? (
        <CardFooter className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={openEdit} disabled={logoutPending}>
            개인정보 수정
          </Button>
          <Button type="button" variant="destructive" onClick={openLogout} disabled={logoutPending}>
            로그아웃
          </Button>
        </CardFooter>
      ) : null}

      {profile ? (
        <Dialog open={editOpen} onOpenChange={(open) => {
          if (!open) closeEdit();
        }}>
          <DialogContent showCloseButton={!editPending}>
            <DialogHeader>
              <DialogTitle>개인정보 수정</DialogTitle>
              <DialogDescription>이메일을 제외한 학생 정보를 수정할 수 있습니다.</DialogDescription>
            </DialogHeader>
            <StudentProfileForm
              email={email}
              profile={profile}
              pending={editPending}
              error={editError}
              onCancel={closeEdit}
              onSubmit={saveProfile}
            />
          </DialogContent>
        </Dialog>
      ) : null}

      <AlertDialog open={logoutOpen} onOpenChange={changeLogoutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>로그아웃</AlertDialogTitle>
            <AlertDialogDescription>이 브라우저에서만 로그아웃합니다.</AlertDialogDescription>
          </AlertDialogHeader>
          {logoutError ? (
            <Alert variant="destructive"><AlertDescription>{logoutError}</AlertDescription></Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={logoutPending}>로그아웃 취소</AlertDialogCancel>
            <AlertDialogAction disabled={logoutPending} onClick={confirmLogout}>
              {logoutPending ? <><Spinner data-icon="inline-start" aria-hidden />로그아웃 중</> : "로그아웃 확인"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
