import { readFileSync } from "node:fs";
// ponytail: schema.sql is the source of truth; better-sqlite3+Kysely only when queries outgrow node:sqlite
export const SCHEMA_PATH = new URL("../../schema.sql", import.meta.url);
export function loadSchema(): string {
  return readFileSync(SCHEMA_PATH, "utf8");
}
