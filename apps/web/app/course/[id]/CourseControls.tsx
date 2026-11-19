"use client";

import { useTransition } from "react";
import { SUBJECTS, SUBJECT_LABELS, type Subject } from "@study/schema";
import { setCourseHidden, setCourseSubject } from "@/lib/actions";

export function CourseControls({ courseId, subject, hidden }: { courseId: string; subject: Subject; hidden: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className="row">
      <label className="visually-hidden" htmlFor="subject">
        Subject folder
      </label>
      <select
        id="subject"
        value={subject}
        disabled={pending}
        onChange={(e) => start(() => setCourseSubject(courseId, e.target.value as Subject))}
        style={{ width: "auto" }}
        title="Which subject folder this course is filed under"
      >
        {SUBJECTS.map((s) => (
          <option key={s} value={s}>
            {SUBJECT_LABELS[s]}
          </option>
        ))}
      </select>
      <button className="btn ghost sm" disabled={pending} onClick={() => start(() => setCourseHidden(courseId, !hidden))}>
        {hidden ? "Unhide" : "Hide course"}
      </button>
    </div>
  );
}
