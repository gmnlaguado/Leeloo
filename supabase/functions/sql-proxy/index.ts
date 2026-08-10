import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { Client } from 'https://deno.land/x/postgres@v0.17.0/mod.ts';

const SQL_PROXY_SECRET = Deno.env.get('SQL_PROXY_SECRET') ?? '';
const SUPABASE_DB_URL = Deno.env.get('DB_URL') ?? '';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-proxy-secret',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const secret = req.headers.get('x-proxy-secret') ?? '';
  if (!SQL_PROXY_SECRET || secret !== SQL_PROXY_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: { sql: string; params?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { sql, params = [] } = body;
  if (!sql || typeof sql !== 'string') {
    return new Response('Missing sql', { status: 400 });
  }

  if (!SUPABASE_DB_URL) {
    return new Response('DB not configured', { status: 503 });
  }

  const client = new Client(SUPABASE_DB_URL);
  try {
    await client.connect();
    const result = await client.queryObject(sql, params as unknown[]);
    return new Response(JSON.stringify({ rows: result.rows }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    try { await client.end(); } catch { /* ignore */ }
  }
});
