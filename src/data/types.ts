// Entity types for Skele's local-first storage. Dates are ISO strings; ranks are
// fractional-index strings (order ascending). One workspace = one database.

import type { PropertyConfig, PropertyType } from "@/features/databases/properties";
import type { ViewConfig } from "@/features/databases/query";
import type { ProjectStatus, TaskPriority, TaskStatus } from "@/features/projects/schemas";

export type ISODate = string;

export type WorkspaceMeta = {
  id: string;
  name: string;
  icon: string | null;
  color: string;
  createdAt: ISODate;
  updatedAt: ISODate;
  lastOpenedAt: ISODate | null;
};

export type PageKind = "DOCUMENT" | "DATABASE";

export type Page = {
  id: string;
  parentId: string | null;
  kind: PageKind;
  title: string;
  icon: string | null;
  cover: string | null;
  coverPosition: number;
  rank: string;
  pinned: boolean;
  fullWidth: boolean;
  isTemplate: boolean;
  tags: string[];
  /** Free-form note properties (key → text). */
  properties: Record<string, string>;
  archivedAt: ISODate | null;
  archivedRootId: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
};

export type PageContent = {
  pageId: string;
  doc: unknown;
  text: string;
  /** #tags found in the text (derived on save). */
  tags: string[];
  version: number;
  updatedAt: ISODate;
};

export type Favorite = { pageId: string; createdAt: ISODate };
export type Visit = { pageId: string; visitedAt: ISODate };
/** A `[[link]]` from one page to another (rebuilt whenever the source page is saved). */
export type PageLink = { id: string; fromId: string; toId: string };

export type Project = {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  color: string;
  status: ProjectStatus;
  startDate: ISODate | null;
  targetDate: ISODate | null;
  lead: string | null;
  rank: string;
  archivedAt: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
};

export type Label = { id: string; name: string; color: string };

export type Task = {
  id: string;
  projectId: string | null;
  parentId: string | null;
  /** Optional linked note. */
  pageId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: ISODate | null;
  assignee: string | null;
  labelIds: string[];
  rank: string;
  completedAt: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
};

export type Comment = { id: string; taskId: string; author: string; body: string; createdAt: ISODate };

export type Database = { id: string; pageId: string; createdAt: ISODate };

export type DbProperty = {
  id: string;
  databaseId: string;
  name: string;
  type: PropertyType;
  config: PropertyConfig;
  rank: string;
};

export type DbRecordRow = {
  id: string;
  databaseId: string;
  title: string;
  icon: string | null;
  values: Record<string, unknown>;
  doc: unknown;
  text: string;
  version: number;
  rank: string;
  createdAt: ISODate;
  updatedAt: ISODate;
};

export type DbViewType = "TABLE" | "BOARD" | "CALENDAR" | "GALLERY" | "LIST";
export type DbViewRow = { id: string; databaseId: string; name: string; type: DbViewType; config: ViewConfig; rank: string };

export type FileRow = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  pageId: string | null;
  blob: Blob;
  createdAt: ISODate;
};

export type SettingRow = { key: string; value: unknown };

/** Table name → row type, shared by every storage adapter. */
export type Tables = {
  pages: Page;
  contents: PageContent;
  favorites: Favorite;
  visits: Visit;
  links: PageLink;
  projects: Project;
  labels: Label;
  tasks: Task;
  comments: Comment;
  databases: Database;
  properties: DbProperty;
  records: DbRecordRow;
  views: DbViewRow;
  files: FileRow;
  settings: SettingRow;
};
export type TableName = keyof Tables;
