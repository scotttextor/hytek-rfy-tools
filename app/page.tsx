"use client";

import { useState } from "react";

type Mode = "rfy-to-text" | "text-to-rfy" | "rfy-to-csv" | "csv-to-rfy";

const MODE_LABELS: Record<Mode, { title: string; from: string; to: string; accept: string; endpoint: string }> = {
  "rfy-to-text": {
    title: "RFY → Plain Text (XML)",
    from: ".rfy",
    to: ".xml",
    accept: ".rfy",
    endpoint: "/api/decode",
  },
  "text-to-rfy": {
    title: "Plain Text (XML) → RFY",
    from: ".xml / .txt",
    to: ".rfy",
    accept: ".xml,.txt",
    endpoint: "/api/encode",
  },
  "rfy-to-csv": {
    title: "RFY → CSV",
    from: ".rfy",
    to: ".csv",
    accept: ".rfy",
    endpoint: "/api/csv-from-rfy",
  },
  "csv-to-rfy": {
    title: "CSV → RFY",
    from: ".csv",
    to: ".rfy",
    accept: ".csv",
    endpoint: "/api/rfy-from-csv",
  },
};

function ConverterCard({ mode }: { mode: Mode }) {
  const cfg = MODE_LABELS[mode];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch(cfg.endpoint, {
        method: "POST",
        headers: {
          "x-filename": encodeURIComponent(file.name),
          "content-type": "application/octet-stream",
        },
        body: buf,
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(`${res.status}: ${msg}`);
      }
      const blob = await res.blob();
      const dispo = res.headers.get("content-disposition") ?? "";
      const m = dispo.match(/filename="([^"]+)"/);
      const outName = m ? m[1] : `output${cfg.to}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = outName;
      a.click();
      URL.revokeObjectURL(url);
      setResult(`Downloaded ${outName} (${(blob.size / 1024).toFixed(1)} KB)`);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-yellow-400/30 bg-zinc-900/60 rounded-2xl p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-yellow-400">{cfg.title}</h2>
        <p className="text-sm text-zinc-400">
          Drop a {cfg.from} file → get {cfg.to}
        </p>
      </div>
      <label
        className={`block border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition ${
          busy ? "border-zinc-700 bg-zinc-900 cursor-wait" : "border-yellow-400/40 hover:border-yellow-400 hover:bg-zinc-900"
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
      </header>

      <div className="grid sm:grid-cols-2 gap-6">
        <ConverterCard mode="rfy-to-text" />
        <ConverterCard mode="text-to-rfy" />
        <ConverterCard mode="rfy-to-csv" />
        <ConverterCard mode="csv-to-rfy" />
      </div>

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
