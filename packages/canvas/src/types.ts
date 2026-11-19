// Subset of the Canvas REST API shapes this app reads. Canvas returns many more fields.

export interface CanvasTerm {
  id: number;
  name: string;
  start_at: string | null;
  end_at: string | null;
}

export interface CanvasCourse {
  id: number;
  name: string;
  course_code: string;
  workflow_state?: string;
  term?: CanvasTerm;
  syllabus_body?: string | null;
  start_at?: string | null;
  end_at?: string | null;
}

export type ModuleItemType =
  | "File"
  | "Page"
  | "Discussion"
  | "Assignment"
  | "Quiz"
  | "SubHeader"
  | "ExternalUrl"
  | "ExternalTool";

export interface CanvasModuleItem {
  id: number;
  module_id: number;
  position: number;
  title: string;
  type: ModuleItemType;
  content_id?: number;
  page_url?: string;
  html_url?: string;
  external_url?: string;
  url?: string;
  content_details?: {
    due_at?: string | null;
    unlock_at?: string | null;
    lock_at?: string | null;
    locked_for_user?: boolean;
  };
}

export interface CanvasModule {
  id: number;
  name: string;
  position: number;
  unlock_at: string | null;
  state?: string;
  items_count?: number;
  items_url?: string;
  items?: CanvasModuleItem[];
}

export interface CanvasPage {
  page_id: number;
  url: string;
  title: string;
  body?: string | null;
  updated_at: string;
  published?: boolean;
  locked_for_user?: boolean;
}

export interface CanvasFile {
  id: number;
  display_name: string;
  filename: string;
  "content-type": string;
  size: number;
  url: string;
  updated_at: string;
  modified_at?: string;
  locked_for_user?: boolean;
  hidden_for_user?: boolean;
}
