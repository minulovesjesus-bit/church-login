import { formatSeoulDateTime } from "./format";
import type { AttendanceScan, TeacherAttendanceItem } from "./types";

function isTeacherItem(scan: AttendanceScan): scan is TeacherAttendanceItem {
  return "student_name" in scan;
}

export function DirectionBadge({ direction }: { direction: AttendanceScan["direction"] }) {
  return (
    <span className={`attendance-badge attendance-badge--${direction.toLowerCase()}`}>
      {direction === "IN" ? "입실" : "퇴실"}
    </span>
  );
}

export function RecordBadges({ scan }: { scan: AttendanceScan }) {
  return (
    <span className="attendance-badge-row">
      {scan.source === "MANUAL" ? (
        <span className="attendance-badge attendance-badge--manual">수동 기록</span>
      ) : (
        <span className="attendance-badge attendance-badge--qr">QR 기록</span>
      )}
      {scan.voided_at ? (
        <span className="attendance-badge attendance-badge--void">취소된 원본</span>
      ) : null}
      {isTeacherItem(scan) && scan.excluded_from_statistics ? (
        <span className="attendance-badge attendance-badge--excluded">통계 제외</span>
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
            <button type="button" className="secondary-button" onClick={() => onSelect(scan)}>
              상세 및 보정
            </button>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
