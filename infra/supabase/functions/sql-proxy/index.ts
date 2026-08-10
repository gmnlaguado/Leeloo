import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const SQL_PROXY_SECRET = Deno.env.get("SQL_PROXY_SECRET") ?? "";
const DB_URL = Deno.env.get("SUPABASE_DB_URL") ?? "";

// Connection pool shared across requests (edge function may be warm across invocations)
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool(DB_URL, 1, true);
  }
  return pool;
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, content-type, x-proxy-secret, apikey",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  // Validate shared secret
  const secret = req.headers.get("x-proxy-secret");
  if (!SQL_PROXY_SECRET || secret !== SQL_PROXY_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json() as { sql: string; params?: unknown[] };
    const { sql, params } = body;

    if (!sql || typeof sql !== "string") {
      return new Response(JSON.stringify({ error: "Missing or invalid sql field" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const client = await getPool().connect();
    try {
      const result = await client.queryObject({
        text: sql,
        args: params && params.length > 0 ? params : [],
      });

      return new Response(
        JSON.stringify({
          rows: result.rows,
          rowCount: result.rowCount ?? result.rows.length,
          command: result.command ?? "SELECT",
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    const err = e as Record<string, unknown>;
    const fields = (err["fields"] as Record<string, unknown>) ?? {};
    return new Response(
      JSON.stringify({
        error: String(err["message"] ?? "Unknown database error"),
        code: fields["code"] ?? err["code"],
        severity: fields["severity"] ?? err["severity"],
        detail: fields["detail"],
        hint: fields["hint"],
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
});
