import { ANON_KEY, PROFILES, SUPABASE_URL, type Profile, type RoleName } from "./env";

/**
 * PostgREST driver for the permission suite.
 *
 * These tests deliberately talk to PostgREST rather than to the app's server functions.
 * That is the boundary an attacker actually has: the REST endpoint is public, and the anon
 * key plus a user's own JWT is enough to reach it. Whatever RLS allows here, a user can do
 * with curl — the TypeScript checks in src/lib/*.functions.ts never run.
 */

export type Session = { role: RoleName; email: string; userId: string; token: string };

export type Result = { status: number; rows: any[]; body: any; error: string | null };

const sessions = new Map<RoleName, Session>();

export async function login(role: RoleName): Promise<Session> {
  const cached = sessions.get(role);
  if (cached) return cached;

  const profile: Profile = PROFILES[role];
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email: profile.email, password: profile.password }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    throw new Error(
      `Login failed for ${profile.email} (HTTP ${res.status}): ${JSON.stringify(body)}\n` +
        "If this is a 400 invalid_grant the accounts are missing — see tests/README.md.\n" +
        "If it is a 500, auth.users token columns are NULL instead of empty strings.",
    );
  }
  const session: Session = {
    role,
    email: profile.email,
    userId: profile.userId,
    token: body.access_token,
  };
  sessions.set(role, session);
  return session;
}

function headers(session: Session | null, extra: Record<string, string> = {}) {
  return {
    apikey: ANON_KEY,
    "content-type": "application/json",
    ...(session ? { authorization: `Bearer ${session.token}` } : {}),
    ...extra,
  };
}

async function toResult(res: Response): Promise<Result> {
  const text = await res.text();
  let body: any = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  const rows = Array.isArray(body) ? body : body && !body.code ? [body] : [];
  const error = body && typeof body === "object" && body.code ? body.message : null;
  return { status: res.status, rows, body, error };
}

export async function select(
  session: Session | null,
  table: string,
  query = "select=*",
): Promise<Result> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: headers(session),
  });
  return toResult(res);
}

/**
 * Every write asks for `return=representation`.
 *
 * This is not a convenience: PostgREST answers 204 to a PATCH or DELETE that RLS filtered
 * down to zero rows, so reading only the status code makes a denial look like a success.
 * Counting the returned rows is the only reliable signal. See knowissues KI-04, which was
 * withdrawn precisely because of this.
 */
export async function insert(session: Session | null, table: string, payload: unknown) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: headers(session, { Prefer: "return=representation" }),
    body: JSON.stringify(payload),
  });
  return toResult(res);
}

/** Same insert, but without asking for the row back — the shape that hides KI-03. */
export async function insertBlind(session: Session | null, table: string, payload: unknown) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: headers(session, { Prefer: "return=minimal" }),
    body: JSON.stringify(payload),
  });
  return toResult(res);
}

export async function update(
  session: Session | null,
  table: string,
  filter: string,
  payload: unknown,
) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: headers(session, { Prefer: "return=representation" }),
    body: JSON.stringify(payload),
  });
  return toResult(res);
}

export async function remove(session: Session | null, table: string, filter: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: "DELETE",
    headers: headers(session, { Prefer: "return=representation" }),
  });
  return toResult(res);
}

export async function rpc(session: Session | null, fn: string, args: unknown = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify(args),
  });
  return toResult(res);
}

/** Exact row count, independent of the default page size. */
export async function count(session: Session | null, table: string, filter = ""): Promise<number> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?select=*${filter ? `&${filter}` : ""}`,
    { headers: headers(session, { Prefer: "count=exact", Range: "0-0" }) },
  );
  const range = res.headers.get("content-range") ?? "";
  await res.text();
  const total = range.split("/")[1];
  return total === "*" || total === undefined ? NaN : Number(total);
}

/**
 * True only when the operation actually touched a row.
 *
 * A 2xx alone is not a permission: see the note on `insert` above.
 */
export function didAffectRows(result: Result): boolean {
  return result.status >= 200 && result.status < 300 && result.rows.length > 0;
}

/** True when the DB refused the operation outright. */
export function wasDenied(result: Result): boolean {
  return result.status === 401 || result.status === 403 || result.error?.includes("row-level security") === true;
}
