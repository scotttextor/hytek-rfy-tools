// Helper for API routes — reads the request body and inflates it if the
// browser gzipped it client-side (to dodge Vercel's 4.5MB function payload limit).
import { gunzipSync } from "node:zlib";

export async function readBody(req: Request): Promise<Buffer> {
  const buf = Buffer.from(await req.arrayBuffer());
  if (req.headers.get("content-encoding") === "gzip") {
    return gunzipSync(buf);
  }
  return buf;
}

export async function readBodyText(req: Request): Promise<string> {
  return (await readBody(req)).toString("utf-8");
}
