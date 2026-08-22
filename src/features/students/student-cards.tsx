import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  calculateInternationalAge,
  type TeacherStudent,
} from "./student-table";

type StudentCardsProps = {
  students: TeacherStudent[];
  disabled?: boolean;
  onEdit: (student: TeacherStudent, opener: HTMLButtonElement) => void;
};

export default function StudentCards({ students, disabled = false, onEdit }: StudentCardsProps) {
  return (
    <ul className="student-mobile-only student-card-list" aria-label="모바일 학생 목록">
      {students.map((student) => (
        <li key={student.user_id}>
          <Card className="student-card">
            <CardHeader className="student-card__heading">
              <div>
                <CardTitle><h3>{student.name}</h3></CardTitle>
                <p>{student.email}</p>
              </div>
              <Badge variant={student.include_in_statistics ? "secondary" : "outline"}>
                {student.include_in_statistics ? "통계 포함" : "통계 제외"}
              </Badge>
            </CardHeader>
            <CardContent>
              <dl>
                <div><dt>나이</dt><dd>만 {calculateInternationalAge(student.birth_date)}세</dd></div>
                <div><dt>연락처</dt><dd>{student.phone}</dd></div>
                <div><dt>보호자 연락처</dt><dd>{student.guardian_phone}</dd></div>
              </dl>
            </CardContent>
            <CardFooter>
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                aria-label={`${student.name} 수정`}
                onClick={(clickEvent) => onEdit(student, clickEvent.currentTarget)}
              >
                학생 정보 수정
              </Button>
            </CardFooter>
          </Card>
        </li>
      ))}
    </ul>
  );
}
