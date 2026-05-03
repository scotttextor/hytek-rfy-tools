"use client";

import { useEffect, useState } from "react";

export interface RulesetEntry {
  name: string;
  description: string;
  created: string;
  readonly: boolean;
  parent: string | null;
  active: boolean;
}

interface Props {
  /** Called after the active ruleset changes — parent should reload data */
  onActiveChanged: (newActive: string) => void;
  /** Whether parent has unsaved changes (controls the "Save to ruleset" button) */
  isDirty: boolean;
  /** Save callback — parent calls server to persist its current edits */
  onSave: () => Promise<void> | void;
}

export default function RulesetSelector({ onActiveChanged, isDirty, onSave }: Props) {
  const [rulesets, setRulesets] = useState<RulesetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const [saveAsDesc, setSaveAsDesc] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadRulesets() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rulesets");
      const j = await res.json() as { rulesets?: RulesetEntry[]; error?: string };
      if (j.error) throw new Error(j.error);
      setRulesets(j.rulesets ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadRulesets(); }, []);

  const active = rulesets.find(r => r.active);

  async function switchActive(name: string) {
    if (busy) return;
    if (active?.name === name) return;
    if (isDirty) {
      const ok = confirm("You have unsaved changes. Switching will lose them. Continue?");
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rulesets/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || "Switch failed");
      await loadRulesets();
      onActiveChanged(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function createSaveAs() {
    if (busy) return;
    if (!saveAsName.trim()) {
      setError("Name is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // First save current edits to the active (if dirty + active is editable)
      if (isDirty && active && !active.readonly) {
        await onSave();
      }
      // Then create the new ruleset cloned from the current active
      const res = await fetch("/api/rulesets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: saveAsName.trim(),
          description: saveAsDesc.trim() || `Copied from ${active?.name ?? "default"}`,
          parent: active?.name ?? "default",
        }),
      });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || "Create failed");
      // Switch to the new ruleset
      await fetch("/api/rulesets/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: saveAsName.trim() }),
      });
      await loadRulesets();
      onActiveChanged(saveAsName.trim());
      setSaveAsName("");
      setSaveAsDesc("");
      setShowSaveAs(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteCurrent() {
    if (!active || active.readonly || active.name === "default") return;
    if (busy) return;
    const ok = confirm(`Delete ruleset "${active.name}"? This cannot be undone.`);
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      // Switch back to default first (can't delete active)
      await fetch("/api/rulesets/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "default" }),
      });
      // Now delete the formerly-active
      const res = await fetch(`/api/rulesets/${encodeURIComponent(active.name)}`, {
        method: "DELETE",
      });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || "Delete failed");
      await loadRulesets();
      onActiveChanged("default");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function revertToDefault() {
    if (busy) return;
    if (active?.name === "default") return;
    if (isDirty) {
      const ok = confirm("Discard unsaved changes and switch to default?");
      if (!ok) return;
    }
    await switchActive("default");
  }

  return (
    <div className="border border-zinc-800 bg-zinc-900/50 rounded-md p-3 mb-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs uppercase text-zinc-500 font-semibold tracking-wide">Active Ruleset</span>
        {loading ? (
          <span className="text-zinc-500 text-sm">loading…</span>
        ) : (
          <select
            value={active?.name ?? "default"}
            onChange={(e) => switchActive(e.target.value)}
            disabled={busy}
            className="bg-zinc-800 text-zinc-100 text-sm rounded px-2 py-1 border border-zinc-700 hover:border-zinc-500 focus:border-amber-400 focus:outline-none"
          >
            {rulesets.map(r => (
              <option key={r.name} value={r.name}>
                {r.name}{r.readonly ? " (read-only)" : ""}
              </option>
            ))}
          </select>
        )}
        {active && (
          <>
            <span className="text-xs text-zinc-400 max-w-md truncate" title={active.description}>
              {active.description}
            </span>
            {active.readonly && (
              <span className="text-xs px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800">
                READ-ONLY
              </span>
            )}
            {active.parent && (
              <span className="text-xs text-zinc-500">parent: {active.parent}</span>
            )}
          </>
        )}
        <span className="flex-1" />
        <button
          onClick={() => setShowSaveAs(true)}
          disabled={busy}
          className="text-sm px-3 py-1 rounded border border-emerald-700 text-emerald-300 hover:bg-emerald-950 disabled:opacity-50"
          title="Create a new named copy of this ruleset and switch to it"
        >
          Save As New…
        </button>
        <button
          onClick={revertToDefault}
          disabled={busy || active?.name === "default"}
          className="text-sm px-3 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
          title="Switch back to the factory default ruleset"
        >
          Revert to Default
        </button>
        <button
          onClick={deleteCurrent}
          disabled={busy || !active || active.readonly}
          className="text-sm px-3 py-1 rounded border border-red-800 text-red-300 hover:bg-red-950 disabled:opacity-30"
          title="Delete the active ruleset (can't delete default)"
        >
          Delete This
        </button>
      </div>
      {error && (
        <div className="mt-2 text-sm text-red-300 bg-red-950/50 border border-red-800 rounded px-2 py-1">
          {error}
        </div>
      )}
      {showSaveAs && (
        <div className="mt-3 border-t border-zinc-800 pt-3">
          <div className="text-sm text-zinc-300 mb-2 font-medium">Create new ruleset (from {active?.name ?? "default"})</div>
          <div className="flex flex-col gap-2">
            <input
              autoFocus
              type="text"
              placeholder="Ruleset name (e.g. test-1, production-2026, fix-89mm)"
              value={saveAsName}
              onChange={(e) => setSaveAsName(e.target.value)}
              className="bg-zinc-800 text-zinc-100 text-sm rounded px-2 py-1.5 border border-zinc-700 focus:border-emerald-500 focus:outline-none"
              maxLength={64}
            />
            <textarea
              placeholder="Description — what's different about this ruleset (e.g. 'Doubled fastener spacing for cyclonic zones')"
              value={saveAsDesc}
              onChange={(e) => setSaveAsDesc(e.target.value)}
              className="bg-zinc-800 text-zinc-100 text-sm rounded px-2 py-1.5 border border-zinc-700 focus:border-emerald-500 focus:outline-none"
              rows={2}
            />
            <div className="flex gap-2">
              <button
                onClick={createSaveAs}
                disabled={busy || !saveAsName.trim()}
                className="text-sm px-3 py-1.5 rounded border border-emerald-700 bg-emerald-950 text-emerald-200 hover:bg-emerald-900 disabled:opacity-40"
              >
                {isDirty && active && !active.readonly ? "Save current edits + Create" : "Create"}
              </button>
              <button
                onClick={() => { setShowSaveAs(false); setSaveAsName(""); setSaveAsDesc(""); setError(null); }}
                disabled={busy}
                className="text-sm px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
