// Vitest setup for the "sqlite" project: the data-layer tests run against the desktop SQLite
// adapter instead of IndexedDB.
import { setStorageEngine } from "@/data/engine";
import { sqliteEngine } from "@/data/adapters/sqlite";
import { createSqliteBackend } from "./sqlite-backend";

setStorageEngine(sqliteEngine(createSqliteBackend().invoke));
