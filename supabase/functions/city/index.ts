/* The one door to a mayor's saved city.
 *
 * Why this exists at all. Supabase enforces RLS against tokens it can verify,
 * and it verifies Clerk, Firebase, Auth0, Cognito and WorkOS. Privy is not one
 * of them, so Postgres cannot be told who the caller is - a policy written
 * against auth.jwt() would be decoration. Something has to verify the Privy
 * token and then speak to the database with authority, and that something must
 * not be the browser, because the key that carries the authority would be in
 * the bundle.
 *
 * So: this function verifies the access token against Privy's public
 * verification key, takes the DID out of the verified claims - never out of
 * the request body, which the caller controls - and reads or writes exactly
 * that one row.
 *
 *   GET  /cities      -> { cities: [{ id, name, day, updated_at }] }
 *   GET  /city?id=    -> { id, name, save, day, updated_at } | { save: null }
 *   POST /city        <- { save, day, name }   makes a NEW city
 *   PUT  /city?id=    <- { save, day }         updates that one
 *   DELETE /city?id=
 *
 * Secrets (Project Settings -> Edge Functions -> Secrets):
 *   PRIVY_APP_ID             your app id. The signing key is fetched from
 *                            Privy's public JWKS, so there is nothing else
 *                            to copy.
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";

const APP_ID = Deno.env.get("PRIVY_APP_ID") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });

/* Privy publishes the public half of its signing key, so verification needs
 * no secret at all - only the app id, to know whose keys to ask for and to
 * check the token was minted for this app and not another one. */
const jwks = createRemoteJWKSet(
  new URL("https://auth.privy.io/api/v1/apps/" + APP_ID + "/jwks.json"),
);

/* Returns the caller's DID, or null. Never throws for an ordinary bad token -
 * an expired session is a normal thing for a browser to present. */
async function didFrom(req: Request): Promise<string | null> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token || !APP_ID) return null;
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: "privy.io",
      audience: APP_ID,
    });
    const sub = typeof payload.sub === "string" ? payload.sub : "";
    return sub.startsWith("did:privy:") ? sub : null;
  } catch {
    return null;
  }
}

const db = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

/* A 48x48 city with its log is about 15KB, 35KB for a dense one with a full
 * log. Half a megabyte is generous headroom - and bounded, because an
 * unbounded body is how one caller fills the table. */
const MAX_BYTES = 512 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Every query is scoped by privy_did as well as id: an id is a guess away
 * from another mayor's city otherwise, and "it is a uuid" is not an access
 * rule. */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const did = await didFrom(req);
  if (!did) return json({ error: "not signed in" }, 401);

  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  if (id && !UUID.test(id)) return json({ error: "bad id" }, 400);
  const path = url.pathname.endsWith("/cities") ? "/cities" : "/city";

  if (req.method === "GET" && path === "/cities") {
    const { data, error } = await db
      .from("cities")
      .select("id, name, day, created_at, updated_at")
      .eq("privy_did", did)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) return json({ error: error.message }, 500);
    return json({ cities: data ?? [] });
  }

  if (req.method === "GET") {
    let q = db
      .from("cities")
      .select("id, name, save, day, updated_at")
      .eq("privy_did", did);
    q = id ? q.eq("id", id) : q.order("updated_at", { ascending: false }).limit(1);
    const { data, error } = await q.maybeSingle();
    if (error) return json({ error: error.message }, 500);
    return json(data ?? { save: null });
  }

  if (req.method === "POST" || req.method === "PUT") {
    const raw = await req.text();
    if (raw.length > MAX_BYTES) return json({ error: "save too large" }, 413);

    let body: { save?: unknown; day?: unknown; name?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "bad json" }, 400);
    }
    if (!body.save || typeof body.save !== "object") return json({ error: "no save" }, 400);

    const day = Number(body.day) || 0;
    const name = String(body.name ?? "My city").slice(0, 80);

    /* POST makes a city, PUT updates the one named. Separating them is what
     * lets "break ground" leave the city you already built alone. */
    if (req.method === "POST" || !id) {
      const { data, error } = await db
        .from("cities")
        .insert({ privy_did: did, name, save: body.save, day })
        .select("id, name, day, updated_at")
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, ...data });
    }

    const { data, error } = await db
      .from("cities")
      .update({ save: body.save, day, name, updated_at: new Date().toISOString() })
      .eq("privy_did", did)
      .eq("id", id)
      .select("id, name, day, updated_at")
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: "no such city" }, 404);
    return json({ ok: true, ...data });
  }

  if (req.method === "DELETE") {
    if (!id) return json({ error: "which city?" }, 400);
    const { error } = await db.from("cities").delete().eq("privy_did", did).eq("id", id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: "method not allowed" }, 405);
});
