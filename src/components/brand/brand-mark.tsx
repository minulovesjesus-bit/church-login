import Image from "next/image";

import { cn } from "@/lib/utils";

export type BrandTone = "dark" | "light";

export function BrandMark({
  className,
  tone = "dark",
}: {
  className?: string;
  tone?: BrandTone;
}) {
  return (
    <Image
      src="/images/calvary-church-logo.svg"
      alt="갈보리교회"
      width={709}
      height={169}
      className={cn(`brand-mark--${tone}`, className)}
    />
  );
}

export function BrandLockup({ tone = "dark" }: { tone?: BrandTone }) {
  return (
    <div className="flex items-center">
      <BrandMark tone={tone} className="h-9 w-auto sm:h-10" />
    </div>
  );
}
