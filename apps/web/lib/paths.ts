import path from "node:path";

/** Local data directory (SQLite db, downloaded files, generated secret). `npm run dev` runs from apps/web. */
export const DATA_DIR = process.env.STUDY_DATA_DIR ?? path.resolve(process.cwd(), "../../.data");
