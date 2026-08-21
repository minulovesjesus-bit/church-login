export type TeacherStudent = {
  user_id: string;
  email: string;
  name: string;
  birth_date: string;
  phone: string;
  guardian_phone: string;
  include_in_statistics: boolean;
};

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
  onEdit: (student: TeacherStudent) => void;
};

export default function StudentTable({ students, disabled = false, onEdit }: StudentTableProps) {
  return (
    <div className="student-desktop-only student-table-wrap">
      <table className="student-table" aria-label="학생 목록">
        <thead>
          <tr>
            <th scope="col">이름</th>
            <th scope="col">나이</th>
            <th scope="col">연락처</th>
            <th scope="col">보호자 연락처</th>
            <th scope="col">통계 상태</th>
            <th scope="col"><span className="sr-only">관리</span></th>
          </tr>
        </thead>
        <tbody>
          {students.map((student) => (
            <tr key={student.user_id}>
              <td>
                <strong>{student.name}</strong>
                <span>{student.email}</span>
              </td>
              <td>만 {calculateInternationalAge(student.birth_date)}세</td>
              <td>{student.phone}</td>
              <td>{student.guardian_phone}</td>
              <td>
                <span className={student.include_in_statistics ? "student-statistics-badge" : "student-statistics-badge student-statistics-badge--excluded"}>
                  {student.include_in_statistics ? "통계 포함" : "통계 제외"}
                </span>
              </td>
              <td>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={disabled}
                  aria-label={`${student.name} 수정`}
                  onClick={() => onEdit(student)}
                >
                  수정
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
