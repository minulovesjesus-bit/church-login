import Image from "next/image";
import { useId, type ReactNode } from "react";

import { BrandLockup } from "@/components/brand/brand-mark";
import { cn } from "@/lib/utils";

type AuthShellProps = {
  title: string;
  description?: string;
  children: ReactNode;
  imagePriority?: boolean;
};

export function AuthShell({
  title,
  description,
  children,
  imagePriority = false,
}: AuthShellProps) {
  const headingId = useId();

  return (
    <main
      aria-labelledby={headingId}
      className="grid min-h-dvh grid-rows-[auto_auto_1fr] overflow-hidden bg-background text-foreground lg:grid-cols-2 lg:grid-rows-[6rem_1fr]"
    >
      <header className="px-4 pt-5 sm:px-8 sm:pt-7 lg:col-span-2 lg:row-start-1 lg:flex lg:h-24 lg:items-center lg:border-b lg:border-border lg:bg-background lg:px-14 lg:py-0">
        <BrandLockup />
      </header>

      <div className="auth-shell-image relative mx-4 mt-5 h-44 overflow-hidden rounded-2xl bg-muted sm:mx-8 sm:h-52 lg:col-start-2 lg:row-start-2 lg:m-0 lg:h-auto lg:min-h-0 lg:rounded-none">
        <Image
          src="/images/auth-open-door.png"
          alt="햇살이 비치는 열린 교회 문"
          fill
          sizes="(min-width: 1024px) 50vw, 100vw"
          priority={imagePriority}
          className="object-cover"
        />
      </div>

      <section className="auth-shell-content flex w-full max-w-lg flex-col justify-start justify-self-center px-4 py-8 sm:px-8 sm:py-10 lg:col-start-1 lg:row-start-2 lg:justify-center lg:px-0 lg:py-12">
        <div className="flex flex-col gap-3">
          <h1
            id={headingId}
            className={cn(
              "max-w-md text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl",
              imagePriority ? "auth-shell-hero-title lg:text-6xl" : "lg:text-5xl",
            )}
          >
            {title}
          </h1>
          {description ? (
            <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">
              {description}
            </p>
          ) : null}
        </div>
        <div data-slot="auth-shell-actions" className="mt-8 flex min-h-11 flex-col gap-5">
          {children}
        </div>
      </section>
    </main>
  );
}
