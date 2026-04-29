// Helper for API routes — reads the request body and inflates it if the
// browser gzipped it client-side (to dodge Vercel's 4.5MB function payload limit).
//
// We check a CUSTOM header `x-body-encoding`, NOT the standard
// `content-encoding`, because Vercel/Next.js may auto-decompress requests
// flagged with `content-encoding: gzip` before they reach the route handler,
// which would cause the bytes we receive to be already-decompressed and our
// gunzipSync would either fail or corrupt them.
import { gunzipSync } from "node:zlib";

export async function readBody(req: Request): Promise<Buffer> {
  const buf = Buffer.from(await req.arrayBuffer());
  const enc = req.headers.get("x-body-encoding") ?? req.headers.get("content-encoding");
  if (enc === "gzip") {
    try {
      return gunzipSync(buf);
    } catch (e) {
      // If the platform already decompressed for us (so the body is plain
      // bytes, not a gzip stream), gunzipSync will throw. In that case, fall
      // back to the raw body.
      if (req.headers.get("x-body-encoding") === "gzip") {
        // We explicitly set this — the body really should be gzipped.
        throw e;
      }
      return buf;
    }
  }
  return buf;
}

export async function readBodyText(req: Request): Promise<string> {
  return (await readBody(req)).toString("utf-8");
}
