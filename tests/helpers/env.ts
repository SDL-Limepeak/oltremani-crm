import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Minimal .env reader. We parse the file ourselves instead of relying on the runtime's
 * auto-loading so the suite behaves the same under `bun test`, `node --test` and CI.
 */
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fileEnv = readEnvFile(join(ROOT, ".env"));

function required(name: string, ...fallbacks: string[]): string {
  for (const key of [name, ...fallbacks]) {
    const v = process.env[key] ?? fileEnv[key];
    if (v) return v;
  }
  throw new Error(
    `Missing ${name} — expected in .env or the environment. See .claude/stack.md.`,
  );
}

export const SUPABASE_URL = required("SUPABASE_URL", "VITE_SUPABASE_URL");
export const ANON_KEY = required("SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY");

/**
 * Local dev server, only used by the public-form suite; skipped when it is not up.
 * Port 8080, not vite's usual 5173 — it is pinned in vite.config.ts.
 */
export const APP_URL = process.env.APP_URL ?? "http://localhost:8080";

export type RoleName = "admin" | "superuser" | "coordinator" | "volunteer" | "noscope";

export type Profile = {
  email: string;
  password: string;
  role: string;
  userId: string;
  groups: string[];
  note: string;
};

type CredentialsFile = { password: string; profiles: Record<RoleName, Profile> };

const CREDENTIALS_PATH = join(ROOT, "tests", "credentials.json");

if (!existsSync(CREDENTIALS_PATH)) {
  throw new Error(
    "tests/credentials.json is missing. Copy tests/credentials.example.json and fill in " +
      "the password, or recreate the accounts with the SQL in tests/README.md.",
  );
}

const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8")) as CredentialsFile;

export const PROFILES = credentials.profiles;

/** UUIDs that are stable in this database and that several suites need. */
export const FIXTURES = {
  categoryVarese: "31e3f71f-9f96-4383-b772-dbc1d6df52ad",
  categoryNapoli: "4b99ee4f-54f6-4285-9028-49e57bb13f5b",
  categoryValidation: "40fa9b54-da60-420d-85d5-ad052c091a0e",
  /** In the Varese group: inside the coordinator's and volunteer's perimeter. */
  partnerInScope: "cecfd5b0-e9d0-4ba5-922f-7d05186aa812",
  /** In the Genova group: outside it. */
  partnerOutOfScope: "6a68964b-6f62-4c84-9446-3769e7ec4d6a",
  cityVarese: "70ccbae9-8e80-4afe-9c20-c5a181f24ed1",
} as const;

/** Everything the suite creates carries this, so leftovers are always identifiable. */
export const TEST_TAG = "AUTOTEST";
