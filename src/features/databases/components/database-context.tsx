"use client";

import { createContext, useContext } from "react";
import type { DatabaseData, DbView, useDatabaseMutations } from "../hooks";
import type { Property } from "../properties";
import type { MemberOption } from "./property-cell";

export type DatabaseCtx = {
  workspaceId: string;
  pageId: string;
  data: DatabaseData;
  view: DbView;
  editable: boolean;
  members: MemberOption[];
  m: ReturnType<typeof useDatabaseMutations>;
  /** Properties shown in the current view, in order. */
  visible: Property[];
  openRecord: (id: string) => void;
  setValue: (recordId: string, propertyId: string, value: unknown) => void;
  createOption: (prop: Property, name: string) => string;
};

const Ctx = createContext<DatabaseCtx | null>(null);
export const DatabaseProvider = Ctx.Provider;

export function useDb() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDb must be used inside a database view");
  return ctx;
}
