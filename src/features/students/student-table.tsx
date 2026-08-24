import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type TeacherStudent = {
  user_id: string;
  email: string;
  name: string;
  birth_date: string;
  phone: string;
  guardian_phone: string;
  include_in_statistics: boolean;
  staff_role: "teacher" | "admin" | null;
};

export function staffRoleLabel(staffRole: TeacherStudent["staff_role"]): string {
  if (staffRole === "admin") return "관리자";
  if (staffRole === "teacher") return "교사";
  return "학생";
}

export function staffRoleBadgeVariant(staffRole: TeacherStudent["staff_role"]): "default" | "secondary" | "outline" {
  if (staffRole === "admin") return "default";
  if (staffRole === "teacher") return "secondary";
  return "outline";
}

function seoulCalendarDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function calculateInternationalAge(
  birthDate: string,
  today = seoulCalendarDate(),
): number {
  const [birthYear, birthMonth, birthDay] = birthDate.split("-").map(Number);
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
  let age = todayYear - birthYear;
  if (todayMonth < birthMonth || (todayMonth === birthMonth && todayDay < birthDay)) {
    age -= 1;
  }
  return age;
}

type StudentTableProps = {
  students: TeacherStudent[];
  disabled?: boolean;
  onEdit: (student: TeacherStudent, opener: HTMLButtonElement) => void;
};

export default function StudentTable({ students, disabled = false, onEdit }: StudentTableProps) {
  return (
    <div className="student-desktop-only student-table-wrap">
      <Table className="student-table" aria-label="학생 목록">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">이름</TableHead>
            <TableHead scope="col">나이</TableHead>
            <TableHead scope="col">연락처</TableHead>
            <TableHead scope="col">보호자 연락처</TableHead>
            <TableHead scope="col">통계 상태</TableHead>
            <TableHead scope="col">권한</TableHead>
            <TableHead scope="col"><span className="sr-only">관리</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {students.map((student) => (
            <TableRow key={student.user_id}>
              <TableCell>
                <strong>{student.name}</strong>
                <span>{student.email}</span>
              </TableCell>
              <TableCell>만 {calculateInternationalAge(student.birth_date)}세</TableCell>
              <TableCell>{student.phone}</TableCell>
              <TableCell>{student.guardian_phone}</TableCell>
              <TableCell>
                <Badge variant={student.include_in_statistics ? "secondary" : "outline"}>
                  {student.include_in_statistics ? "통계 포함" : "통계 제외"}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={staffRoleBadgeVariant(student.staff_role)}>
                  {staffRoleLabel(student.staff_role)}
                </Badge>
              </TableCell>
              <TableCell>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  aria-label={`${student.name} 수정`}
                  onClick={(clickEvent) => onEdit(student, clickEvent.currentTarget)}
                >
                  수정
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
