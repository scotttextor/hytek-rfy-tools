"use client";

import { useState } from "react";

type Mode = "decode-bundle" | "encode-auto" | "rfy-to-csv" | "csv-to-rfy";

const MODE_LABELS: Record<Mode, { title: string; subtitle: string; from: string; accept: string; endpoint: string }> = {
  "decode-bundle": {
    title: "RFY → Text + XML + HTML",
    subtitle: "Upload an .rfy → ZIP with .txt (Notepad), .xml (full schedule), and .html (browser table view). Edit any one.",
    from: ".rfy",
    accept: ".rfy",
    endpoint: "/api/decode-bundle",
  },
  "encode-auto": {
    title: "Text / XML / HTML → RFY",
    subtitle: "Upload your edited .txt, .xml, or .html → fresh .rfy. App auto-detects the format.",
    from: ".txt / .xml / .html / .csv",
    accept: ".txt,.xml,.html,.htm,.csv",
    endpoint: "/api/encode-auto",
  },
  "rfy-to-csv": {
    title: "RFY → CSV",
    subtitle: "Just the rollformer CSV, no headers. For tools/scripts that want raw CSV.",
    from: ".rfy",
    accept: ".rfy",
    endpoint: "/api/csv-from-rfy",
  },
  "csv-to-rfy": {
    title: "CSV → RFY",
    subtitle: "Synthesize an RFY directly from a single-plan rollformer CSV.",
    from: ".csv",
    accept: ".csv",
    endpoint: "/api/rfy-from-csv",
  },
};

function ConverterCard({ mode, primary = false }: { mode: Mode; primary?: boolean }) {
  const cfg = MODE_LABELS[mode];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const rawBuf = await file.arrayBuffer();

      // Vercel functions cap request bodies at 4.5MB. XML files inflate ~16x
      // when decoded from RFY, so gzip them in the browser before upload.
      // Server-side handlers detect Content-Encoding: gzip and inflate.
      let body: ArrayBuffer | Uint8Array = rawBuf;
      const headers: Record<string, string> = {
        "x-filename": encodeURIComponent(file.name),
        "content-type": "application/octet-stream",
      };
      if (rawBuf.byteLength > 1_000_000 && typeof CompressionStream !== "undefined") {
        const stream = new Blob([rawBuf]).stream().pipeThrough(new CompressionStream("gzip"));
        const compressed = await new Response(stream).arrayBuffer();
        body = compressed;
        headers["content-encoding"] = "gzip";
      }

      const res = await fetch(cfg.endpoint, {
        method: "POST",
        headers,
        body,
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(`${res.status}: ${msg}`);
      }
      const blob = await res.blob();
      const dispo = res.headers.get("content-disposition") ?? "";
      const m = dispo.match(/filename="([^"]+)"/);
      const outName = m ? m[1] : "output";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = outName;
      a.click();
      URL.revokeObjectURL(url);
      const detected = res.headers.get("x-detected-format");
      const detectedNote = detected ? ` — detected: ${detected}` : "";
      setResult(`Downloaded ${outName} (${(blob.size / 1024).toFixed(1)} KB)${detectedNote}`);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`rounded-2xl p-6 flex flex-col gap-4 ${
        primary
          ? "border-2 border-yellow-400 bg-zinc-900"
          : "border border-zinc-700 bg-zinc-900/40"
      }`}
    >
      <div>
        <h2 className={`text-xl font-semibold ${primary ? "text-yellow-400" : "text-zinc-300"}`}>{cfg.title}</h2>
        <p className="text-sm text-zinc-400 mt-1">{cfg.subtitle}</p>
      </div>
      <label
        className={`block border-2 border-dashed rounded-xl p-${primary ? "8" : "6"} text-center cursor-pointer transition ${
          busy
            ? "border-zinc-700 bg-zinc-900 cursor-wait"
            : primary
              ? "border-yellow-400/60 hover:border-yellow-400 hover:bg-zinc-800"
              : "border-zinc-600 hover:border-zinc-400 hover:bg-zinc-800"
        }`}
      >
        <input
          type="file"
          accept={cfg.accept}
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
          className="hidden"
        />
        <span className="text-sm text-zinc-300">
          {busy ? "Converting…" : `Click to choose a ${cfg.from} file`}
        </span>
      </label>
      {error && <div className="text-sm text-red-400 break-words">{error}</div>}
      {result && <div className="text-sm text-green-400">{result}</div>}
    </div>
  );
}

export default function Page() {
  return (
    <main className="min-h-screen p-8 max-w-5xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">
          <span className="text-yellow-400">HYTEK</span> RFY Tools
        </h1>
        <p className="text-zinc-400 mt-1">
          Decode, edit, and re-encode FrameCAD <code className="text-yellow-400">.rfy</code> files.
        </p>
        <p className="text-zinc-500 text-sm mt-3">
          <strong className="text-zinc-300">Standard workflow:</strong>{" "}
          (1) Decode → get <code>.txt</code> + <code>.xml</code> bundle ·{" "}
          (2) Open either in Notepad → edit ·{" "}
          (3) Upload the edited file → get a new <code>.rfy</code>.
        </p>
      </header>

      <h3 className="text-xs uppercase tracking-wider text-yellow-400 mb-3">Standard — both formats at once</h3>
      <div className="grid sm:grid-cols-2 gap-6">
        <ConverterCard mode="decode-bundle" primary />
        <ConverterCard mode="encode-auto" primary />
      </div>

      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mt-10 mb-3">CSV only — for scripts / tools</h3>
      <div className="grid sm:grid-cols-2 gap-6">
        <ConverterCard mode="rfy-to-csv" />
        <ConverterCard mode="csv-to-rfy" />
      </div>

      <section className="mt-10 rounded-xl border border-zinc-700 bg-zinc-900/50 p-5 text-sm text-zinc-400">
        <h3 className="font-semibold text-zinc-200 mb-2">Which format should I edit?</h3>
        <ul className="space-y-2">
          <li>
            <strong className="text-yellow-400">.txt</strong> (from the standard decode) — plain-text rollformer
            CSV with helpful headers/comments. Easiest in Notepad. Round-trip strips graphics/3D.
          </li>
          <li>
            <strong className="text-yellow-400">.xml</strong> — full FrameCAD schedule with everything
            (3D mesh, design GUIDs). Edit when fidelity matters. Re-encrypted byte-for-byte back to RFY.
          </li>
          <li>
            <strong className="text-yellow-400">.html</strong> — same data as <code>.txt</code> but rendered
            as an editable table in any browser. Click a cell, type, save the page, re-upload.
          </li>
          <li>
            <strong className="text-yellow-400">.csv</strong> (from the CSV-only buttons) — single-plan
            CSV without any wrapping. For external tools / scripts that consume raw CSV.
          </li>
        </ul>
      </section>

      <footer className="mt-10 text-xs text-zinc-500">
        Powered by{" "}
        <a href="https://github.com/scotttextor/hytek-rfy-codec" className="text-yellow-400 hover:underline">
          @hytek/rfy-codec
        </a>
        . All processing happens server-side.
      </footer>
    </main>
  );
}
