import fs from "fs";
import path from "path";
import { Database } from "./types";

const DB_PATH = path.join(process.cwd(), "data", "db.json");

const EMPTY_DB: Database = {
  users: [],
  merchants: [],
  products: [],
  transactions: [],
  sessions: []
};

function ensureDataDir(): void {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

function writeDb(db: Database): void {
  ensureDataDir();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function readDb(): Database {
  ensureDataDir();
  if (!fs.existsSync(DB_PATH)) {
    writeDb(EMPTY_DB);
    return structuredClone(EMPTY_DB);
  }

  const raw = fs.readFileSync(DB_PATH, "utf8").trim();
  if (!raw) {
    writeDb(EMPTY_DB);
    return structuredClone(EMPTY_DB);
  }

  try {
    const parsed = JSON.parse(raw) as Database;
    return {
      users: parsed.users ?? [],
      merchants: parsed.merchants ?? [],
      products: parsed.products ?? [],
      transactions: parsed.transactions ?? [],
      sessions: parsed.sessions ?? []
    };
  } catch {
    writeDb(EMPTY_DB);
    return structuredClone(EMPTY_DB);
  }
}

let memoryDb = readDb();

export function getDb(): Database {
  return memoryDb;
}

export function updateDb(mutator: (db: Database) => void): Database {
  mutator(memoryDb);
  writeDb(memoryDb);
  return memoryDb;
}
