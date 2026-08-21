import { formatSeoulDateTime } from "./format";
import { DirectionBadge, RecordBadges } from "./history-list";
import type { AttendanceScan, TeacherAttendanceItem } from "./types";

function isTeacherItem(scan: AttendanceScan): scan is TeacherAttendanceItem {
  return "student_name" in scan;
}

export function AttendanceTable({
  scans,
  onSelect,
}: {
  scans: AttendanceScan[];
  onSelect?: (scan: TeacherAttendanceItem) => void;
}) {
  const teacherTable = scans.some(isTeacherItem);
  return (
    <div className="attendance-table-wrap">
      <table className="attendance-table">
        <caption className="sr-only">출결 상세 기록</caption>
        <thead>
          <tr>
            {teacherTable ? <th scope="col">학생</th> : null}
            <th scope="col">일시</th>
            <th scope="col">상태</th>
            <th scope="col">기록 구분</th>
            {onSelect ? <th scope="col">관리</th> : null}
          </tr>
        </thead>
        <tbody>
          {scans.map((scan) => (
            <tr className={scan.voided_at ? "attendance-table__voided" : undefined} key={scan.id}>
              {teacherTable ? (
                <td>
                  {isTeacherItem(scan) ? (
                    <><strong>{scan.student_name}</strong><span>{scan.student_email}</span></>
                  ) : null}
                </td>
              ) : null}
              <td><time dateTime={scan.scanned_at}>{formatSeoulDateTime(scan.scanned_at)}</time></td>
              <td><DirectionBadge direction={scan.direction} /></td>
              <td>
                <RecordBadges scan={scan} />
                {scan.void_reason ? <span className="attendance-void-reason">사유: {scan.void_reason}</span> : null}
              </td>
              {onSelect ? (
                <td>
                  {isTeacherItem(scan) ? (
                    <button type="button" className="secondary-button" onClick={() => onSelect(scan)}>
                      상세 및 보정
                    </button>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
