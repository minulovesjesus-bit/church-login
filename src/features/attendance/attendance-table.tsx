import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
  onSelect?: (scan: TeacherAttendanceItem, opener: HTMLButtonElement) => void;
}) {
  const teacherTable = scans.some(isTeacherItem);
  return (
    <Table className="attendance-table">
      <TableCaption className="sr-only">출결 상세 기록</TableCaption>
      <TableHeader>
        <TableRow>
          {teacherTable ? <TableHead scope="col">학생</TableHead> : null}
          <TableHead scope="col">일시</TableHead>
          <TableHead scope="col">상태</TableHead>
          <TableHead scope="col">기록 구분</TableHead>
          {onSelect ? <TableHead scope="col">관리</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
          {scans.map((scan) => (
            <TableRow data-voided={scan.voided_at ? "true" : undefined} key={scan.id}>
              {teacherTable ? (
                <TableCell>
                  {isTeacherItem(scan) ? (
                    <><strong>{scan.student_name}</strong><span>{scan.student_email}</span></>
                  ) : null}
                </TableCell>
              ) : null}
              <TableCell><time dateTime={scan.scanned_at}>{formatSeoulDateTime(scan.scanned_at)}</time></TableCell>
              <TableCell><DirectionBadge direction={scan.direction} /></TableCell>
              <TableCell>
                <RecordBadges scan={scan} />
                {scan.void_reason ? <span className="attendance-void-reason">사유: {scan.void_reason}</span> : null}
              </TableCell>
              {onSelect ? (
                <TableCell>
                  {isTeacherItem(scan) ? (
                    <Button
                      type="button"
                      variant="outline"
                      aria-label={`${scan.student_name} 출결 상세 보기`}
                      onClick={(event) => onSelect(scan, event.currentTarget)}
                    >
                      상세 보기
                    </Button>
                  ) : null}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
      </TableBody>
    </Table>
  );
}
