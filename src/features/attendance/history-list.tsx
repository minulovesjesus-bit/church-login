import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { formatSeoulDateTime } from "./format";
import type { AttendanceScan, TeacherAttendanceItem } from "./types";

function isTeacherItem(scan: AttendanceScan): scan is TeacherAttendanceItem {
  return "student_name" in scan;
}

export function DirectionBadge({ direction }: { direction: AttendanceScan["direction"] }) {
  return (
    <Badge data-direction={direction} variant={direction === "IN" ? "default" : "secondary"}>
      {direction === "IN" ? "입실" : "퇴실"}
    </Badge>
  );
}

export function RecordBadges({ scan }: { scan: AttendanceScan }) {
  return (
    <span className="attendance-badge-row">
      {scan.source === "MANUAL" ? (
        <Badge variant="secondary">수동 기록</Badge>
      ) : (
        <Badge variant="outline">QR 기록</Badge>
      )}
      {scan.voided_at ? (
        <Badge variant="destructive">취소된 원본</Badge>
      ) : null}
      {isTeacherItem(scan) && scan.excluded_from_statistics ? (
        <Badge variant="outline">통계 제외</Badge>
      ) : null}
    </span>
  );
}

export function HistoryList({
  scans,
  onSelect,
}: {
  scans: AttendanceScan[];
  onSelect?: (scan: TeacherAttendanceItem) => void;
}) {
  return (
    <ol className="attendance-timeline" aria-label="출결 기록 목록">
      {scans.map((scan) => (
        <li className="attendance-timeline__item" key={scan.id}>
          <div className="attendance-timeline__topline">
            <DirectionBadge direction={scan.direction} />
            <time dateTime={scan.scanned_at}>{formatSeoulDateTime(scan.scanned_at)}</time>
          </div>
          {isTeacherItem(scan) ? (
            <div>
              <strong>{scan.student_name}</strong>
              <p>{scan.student_email}</p>
            </div>
          ) : null}
          <RecordBadges scan={scan} />
          {scan.void_reason ? <p className="attendance-void-reason">사유: {scan.void_reason}</p> : null}
          {onSelect && isTeacherItem(scan) ? (
            <Button
              type="button"
              variant="outline"
              aria-label={`${scan.student_name} 상세 및 보정`}
              onClick={() => onSelect(scan)}
            >
              상세 및 보정
            </Button>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
