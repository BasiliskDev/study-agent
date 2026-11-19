import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { ProblemCheck, ProblemSet, Subject, TopicOutline } from "@study/schema";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`);

export const users = sqliteTable("users", {
  id: id(),
  canvasBaseUrl: text("canvas_base_url"),
  /** AES-256-GCM ciphertext, see lib/crypto.ts */
  canvasTokenEnc: text("canvas_token_enc"),
  canvasUserName: text("canvas_user_name"),
  createdAt: createdAt(),
});

export const courses = sqliteTable(
  "courses",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    canvasId: integer("canvas_id").notNull(),
    name: text("name").notNull(),
    courseCode: text("course_code").notNull(),
    term: text("term"),
    subject: text("subject").$type<Subject>().notNull().default("other"),
    /** true once the user picks a subject by hand; sync then leaves it alone */
    subjectLocked: integer("subject_locked", { mode: "boolean" }).notNull().default(false),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    syllabusText: text("syllabus_text"),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("courses_user_canvas").on(t.userId, t.canvasId)],
);

export const materials = sqliteTable(
  "materials",
  {
    id: id(),
    courseId: text("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"syllabus" | "page" | "file">().notNull(),
    /** Canvas page url or file id, stable across syncs */
    canvasKey: text("canvas_key").notNull(),
    title: text("title").notNull(),
    moduleName: text("module_name"),
    /** order within the course: module position * 1000 + item position */
    position: integer("position").notNull().default(0),
    unlockAt: text("unlock_at"),
    contentType: text("content_type"),
    sizeBytes: integer("size_bytes"),
    pages: integer("pages"),
    textContent: text("text_content"),
    /** storage key for downloaded files */
    blobKey: text("blob_key"),
    /** Files API id, cached so a PDF is uploaded to Claude once */
    anthropicFileId: text("anthropic_file_id"),
    /** Canvas updated_at; unchanged → skip re-download */
    sourceVersion: text("source_version"),
    contentHash: text("content_hash"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("materials_course_key").on(t.courseId, t.kind, t.canvasKey), index("materials_course").on(t.courseId)],
);

export const topicOutlines = sqliteTable("topic_outlines", {
  courseId: text("course_id").primaryKey().references(() => courses.id, { onDelete: "cascade" }),
  outline: text("outline", { mode: "json" }).$type<TopicOutline>().notNull(),
  sourceHash: text("source_hash").notNull(),
  createdAt: createdAt(),
});

export type ProblemSetKind = "auto" | "custom" | "exam_prep";

export const problemSets = sqliteTable(
  "problem_sets",
  {
    id: id(),
    courseId: text("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    prompt: text("prompt"),
    kind: text("kind").$type<ProblemSetKind>().notNull(),
    data: text("data", { mode: "json" }).$type<ProblemSet>().notNull(),
    checks: text("checks", { mode: "json" }).$type<Record<string, ProblemCheck>>(),
    jobId: text("job_id"),
    createdAt: createdAt(),
  },
  (t) => [index("problem_sets_course").on(t.courseId)],
);

export const attempts = sqliteTable(
  "attempts",
  {
    problemSetId: text("problem_set_id").notNull().references(() => problemSets.id, { onDelete: "cascade" }),
    problemId: text("problem_id").notNull(),
    correct: integer("correct", { mode: "boolean" }).notNull(),
    answeredAt: integer("answered_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.problemSetId, t.problemId, t.answeredAt] })],
);

export type JobEvent = { t: number; level: "info" | "tool" | "warn" | "error" | "done"; msg: string };

export const jobs = sqliteTable("jobs", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").$type<"sync" | "generate">().notNull(),
  courseId: text("course_id"),
  status: text("status").$type<"running" | "succeeded" | "failed">().notNull().default("running"),
  log: text("log", { mode: "json" }).$type<JobEvent[]>().notNull().default(sql`'[]'`),
  /** e.g. the problem set id a generate job produced */
  resultId: text("result_id"),
  usage: text("usage", { mode: "json" }).$type<Record<string, number>>(),
  createdAt: createdAt(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
});
