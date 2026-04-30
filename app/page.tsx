"use client";

import { useState } from "react";

type Mode = "decode-bundle" | "encode-auto" | "rfy-to-csv" | "csv-to-rfy";

const MODE_LABELS: Record<Mode, { title: string; subtitle: string; from: string; accept: string; endpoint: string }> = {
  "decode-bundle": {
    title: "RFY → Plain Text + XML",
    subtitle: "Upload an .rfy → ZIP with both .txt (Notepad-friendly) and .xml. Edit either one.",
    from: ".rfy",
    accept: ".rfy",
    endpoint: "/api/decode-bundle",
  },
  "encode-auto": {
    title: "Plain Text or XML → RFY",
    subtitle: "Upload your edited .txt or .xml → fresh .rfy. App auto-detects the format.",
    from: ".txt / .xml / .csv",
    accept: ".txt,.xml,.csv",
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
      // Client-side extension check — the file picker's `accept` attribute can be
      // bypassed by switching to "All files", and uploading the wrong file type
      // is the #1 user error. Catch it before sending to the server.
      const allowedExts = cfg.accept.split(",").map(s => s.trim().toLowerCase());
      const lowerName = file.name.toLowerCase();
      const okExt = allowedExts.some(ext => lowerName.endsWith(ext));
      if (!okExt) {
        throw new Error(
          `Wrong file type for this card. "${cfg.title}" expects ${cfg.from}, but you picked "${file.name}". ` +
          `Use the OTHER card if you want to convert this file.`
        );
      }

      const rawBuf = await file.arrayBuffer();

      // Send the file as raw bytes via Blob — fetch sets the right framing
      // and Vercel passes the body through to our handler unchanged.
      // (We previously gzipped large bodies to dodge Vercel's 4.5MB cap, but
      // that path corrupted bytes via auto-decompression; for now we let
      // Vercel reject anything over 4.5MB and give the user a clear message.)
      const res = await fetch(cfg.endpoint, {
        method: "POST",
        headers: {
          "x-filename": encodeURIComponent(file.name),
        },
        body: new Blob([rawBuf], { type: "application/octet-stream" }),
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
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-3xl font-bold">
            <span className="text-yellow-400">HYTEK</span> RFY Tools
          </h1>
          <a
            href="/rules"
            className="text-sm px-3 py-1.5 rounded border border-zinc-700 hover:border-yellow-400 hover:text-yellow-400 text-zinc-300 transition"
          >
            Rules Manager →
          </a>
        </div>
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
