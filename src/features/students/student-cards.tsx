import {
  calculateInternationalAge,
  type TeacherStudent,
} from "./student-table";

type StudentCardsProps = {
  students: TeacherStudent[];
  disabled?: boolean;
  onEdit: (student: TeacherStudent) => void;
};

export default function StudentCards({ students, disabled = false, onEdit }: StudentCardsProps) {
  return (
    <ul className="student-mobile-only student-card-list" aria-label="모바일 학생 목록">
      {students.map((student) => (
        <li key={student.user_id}>
          <article className="student-card">
            <div className="student-card__heading">
              <div>
                <h3>{student.name}</h3>
                <p>{student.email}</p>
              </div>
              <span className={student.include_in_statistics ? "student-statistics-badge" : "student-statistics-badge student-statistics-badge--excluded"}>
                {student.include_in_statistics ? "통계 포함" : "통계 제외"}
              </span>
            </div>
            <dl>
              <div><dt>나이</dt><dd>만 {calculateInternationalAge(student.birth_date)}세</dd></div>
              <div><dt>연락처</dt><dd>{student.phone}</dd></div>
              <div><dt>보호자 연락처</dt><dd>{student.guardian_phone}</dd></div>
            </dl>
            <button
              type="button"
              className="secondary-button"
              disabled={disabled}
              aria-label={`${student.name} 수정`}
              onClick={() => onEdit(student)}
            >
              학생 정보 수정
            </button>
          </article>
        </li>
      ))}
    </ul>
  );
}
