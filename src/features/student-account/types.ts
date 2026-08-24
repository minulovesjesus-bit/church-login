export type StudentProfile = {
  name: string;
  birth_date: string;
  phone: string;
  guardian_phone: string;
  include_in_statistics: boolean;
};

export type EditableStudentProfile = Pick<
  StudentProfile,
  "name" | "birth_date" | "phone" | "guardian_phone"
>;
