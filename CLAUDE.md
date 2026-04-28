@AGENTS.md

# HYTEK RFY Tools

Web utility for converting between FrameCAD RFY, plain-text XML, and CSV formats.
Lets factory operators decrypt an RFY, hand-edit the XML, and re-encrypt — or
round-trip RFY ↔ CSV without going through Detailer.

## Tech Stack
- Next.js 16 (App Router) + React 19
- Tailwind CSS v4
- `@hytek/rfy-codec` (sibling repo) for decode/encode/CSV synthesis
- All conversions run server-side (the codec uses node:crypto + node:zlib)

## Routes

| API endpoint | Function |
|--------------|----------|
| `POST /api/decode` | RFY bytes → XML text (decrypt + decompress) |
| `POST /api/encode` | XML text → RFY bytes (compress + encrypt) |
| `POST /api/csv-from-rfy` | RFY bytes → CSV text (decode → documentToCsvs) |
| `POST /api/rfy-from-csv` | CSV text → RFY bytes (synthesizeRfyFromCsv) |

Each route accepts the input as the request body and returns the converted
output with a `content-disposition` header for direct download.

## UI

Single page (`app/page.tsx`) with 4 drop-zone cards — one per conversion.
User picks a file, the route runs server-side, and the browser auto-downloads
the result.

## Branding
- Yellow #FFCB05, Black #231F20
- Same conventions as ITM / Hub / Detailing

## Hub integration

This app is intended to be added as a tile in `hytek-hub` after deployment to
Vercel. Tile points to `https://hytek-rfy-tools.vercel.app` (or whatever the
final domain is).
