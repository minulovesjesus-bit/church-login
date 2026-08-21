import { attendanceFixtureEnabled } from "@/lib/testing/attendance-fixture-gate";

import { StudentScanClient } from "./scan-client";

export default function StudentScanPage() {
  return (
    <main className="student-scan-shell">
      <StudentScanClient testFixtureEnabled={attendanceFixtureEnabled(process.env)} />
    </main>
  );
}
