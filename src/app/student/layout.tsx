import type { ReactNode } from "react";

import { StudentNavigation } from "@/components/navigation/student-navigation";

export default function StudentLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="student-layout"><div className="student-layout__content">{children}</div><StudentNavigation /></div>;
}
