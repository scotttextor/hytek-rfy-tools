// ProfilePickerDialog — modal that pops after the user finishes drawing
// a new stick on the canvas (Wall.tsx). User picks the profile to
// commit the stick with; Cancel = discard the draw entirely.
//
// Defaults are chosen in this order:
//   1. The currently-selected stick's profile (inherit-from-selected)
//   2. The store's `lastUsedProfile` (remember-last-used)
//   3. PROFILE_OPTIONS[0]  (HYTEK's most common — 70S41/0.75)
//
// Confirming the pick calls `store.addStick(start, end, profile)` and
// updates `lastUsedProfile` so the next draw remembers it.

"use client";
import { useMemo, useState } from "react";
import type { RfyProfile } from "@hytek/rfy-codec";
import { useViewerStore } from "../store";

/** HYTEK's common section profiles. metricLabel + gauge form the unique
 *  key the user picks; the other fields are filled in from this table.
 *  Source: HYTEK Detailer machine-setups + frame-types JSON exports. */
interface ProfileOption {
  label: string;
  profile: RfyProfile;
}

const PROFILE_OPTIONS: ProfileOption[] = [
  {
    label: "70 S 41 · 0.75",
    profile: { metricLabel: "70 S 41", imperialLabel: "275 S 161", gauge: "0.75", yield: "550", machineSeries: "F300i", shape: "S", web: 70, lFlange: 41, rFlange: 38, lip: 12 },
  },
  {
    label: "70 S 41 · 0.95",
    profile: { metricLabel: "70 S 41", imperialLabel: "275 S 161", gauge: "0.95", yield: "550", machineSeries: "F300i", shape: "S", web: 70, lFlange: 41, rFlange: 38, lip: 12 },
  },
  {
    label: "70 S 41 · 1.15",
    profile: { metricLabel: "70 S 41", imperialLabel: "275 S 161", gauge: "1.15", yield: "550", machineSeries: "F300i", shape: "S", web: 70, lFlange: 41, rFlange: 38, lip: 12 },
  },
  {
    label: "89 S 41 · 0.75",
    profile: { metricLabel: "89 S 41", imperialLabel: "350 S 161", gauge: "0.75", yield: "550", machineSeries: "F300i", shape: "S", web: 89, lFlange: 41, rFlange: 38, lip: 12 },
  },
  {
    label: "89 S 41 · 0.95",
    profile: { metricLabel: "89 S 41", imperialLabel: "350 S 161", gauge: "0.95", yield: "550", machineSeries: "F300i", shape: "S", web: 89, lFlange: 41, rFlange: 38, lip: 12 },
  },
  {
    label: "89 S 41 · 1.15",
    profile: { metricLabel: "89 S 41", imperialLabel: "350 S 161", gauge: "1.15", yield: "550", machineSeries: "F300i", shape: "S", web: 89, lFlange: 41, rFlange: 38, lip: 12 },
  },
];

/** Format a profile (any source — option, inherited, last-used) as the
 *  string used in the dropdown for matching. */
function profileKey(p: RfyProfile): string {
  return `${p.metricLabel}|${p.gauge}`;
}

interface ProfilePickerDialogProps {
  /** Drag start in elevation coords. */
  start: { x: number; y: number };
  /** Drag end in elevation coords. */
  end: { x: number; y: number };
  /** Closes the dialog without adding a stick. */
  onCancel: () => void;
  /** Called after a successful add — Wall.tsx uses this to clear its
   *  pending-draw state. */
  onCommit: () => void;
}

export function ProfilePickerDialog({ start, end, onCancel, onCommit }: ProfilePickerDialogProps) {
  const addStick = useViewerStore((s) => s.addStick);
  const lastUsedProfile = useViewerStore((s) => s.lastUsedProfile);
  const doc = useViewerStore((s) => s.doc);
  const selectedPlanIdx = useViewerStore((s) => s.selectedPlanIdx);
  const selectedFrameIdx = useViewerStore((s) => s.selectedFrameIdx);
  const selectedStickKey = useViewerStore((s) => s.selectedStickKey);

  // Resolve the inherit-from-selected stick (if any) so we can both pick
  // it as the default AND surface it as a one-tap option in the dropdown
  // even if it's not in PROFILE_OPTIONS.
  const inheritedProfile: RfyProfile | null = useMemo(() => {
    if (!doc || !selectedStickKey) return null;
    const [, stickIdxStr] = selectedStickKey.split("-");
    const stickIdx = parseInt(stickIdxStr ?? "", 10);
    if (Number.isNaN(stickIdx)) return null;
    const stick = doc.project.plans[selectedPlanIdx]?.frames[selectedFrameIdx]?.sticks[stickIdx];
    return stick?.profile ?? null;
  }, [doc, selectedPlanIdx, selectedFrameIdx, selectedStickKey]);

  // Pick a default in inherit > last-used > first-option order.
  const defaultProfile: RfyProfile = inheritedProfile ?? lastUsedProfile ?? PROFILE_OPTIONS[0]!.profile;

  // Build the dropdown options. If inherited or last-used profiles
  // aren't already in PROFILE_OPTIONS, prepend them so the user can
  // see them at the top.
  const options: ProfileOption[] = useMemo(() => {
    const base = [...PROFILE_OPTIONS];
    const have = new Set(base.map((o) => profileKey(o.profile)));
    const extras: ProfileOption[] = [];
    if (inheritedProfile && !have.has(profileKey(inheritedProfile))) {
      extras.push({ label: `${inheritedProfile.metricLabel} · ${inheritedProfile.gauge} (selected stick)`, profile: inheritedProfile });
      have.add(profileKey(inheritedProfile));
    }
    if (lastUsedProfile && !have.has(profileKey(lastUsedProfile))) {
      extras.push({ label: `${lastUsedProfile.metricLabel} · ${lastUsedProfile.gauge} (last used)`, profile: lastUsedProfile });
    }
    return [...extras, ...base];
  }, [inheritedProfile, lastUsedProfile]);

  const [selectedKey, setSelectedKey] = useState(profileKey(defaultProfile));

  function commit() {
    const opt = options.find((o) => profileKey(o.profile) === selectedKey);
    const profile = opt ? opt.profile : defaultProfile;
    addStick(start, end, profile);
    onCommit();
  }

  // Length preview so the user can sanity-check the drag distance.
  const length = Math.hypot(end.x - start.x, end.y - start.y);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
      onClick={onCancel}
    >
      <div
        className="bg-zinc-900 border border-yellow-400/40 rounded-lg w-96 p-6 text-zinc-100"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter") commit();
        }}
      >
        <h2 className="text-lg font-bold mb-1">
          New stick <span className="text-yellow-400">·</span> pick profile
        </h2>
        <div className="text-xs text-zinc-500 mb-4">
          Length: <span className="font-mono text-zinc-300">{length.toFixed(1)} mm</span>
          {inheritedProfile && (
            <span className="ml-2 text-zinc-600">· inheriting from selected stick</span>
          )}
          {!inheritedProfile && lastUsedProfile && (
            <span className="ml-2 text-zinc-600">· using last-picked profile</span>
          )}
        </div>

        <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-2">
          Profile
        </label>
        <select
          value={selectedKey}
          onChange={(e) => setSelectedKey(e.target.value)}
          autoFocus
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm mb-6"
        >
          {options.map((o) => (
            <option key={profileKey(o.profile)} value={profileKey(o.profile)}>
              {o.label}
            </option>
          ))}
        </select>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 text-sm hover:border-zinc-500 transition"
          >
            Cancel
          </button>
          <button
            onClick={commit}
            className="px-3 py-1.5 rounded bg-yellow-400 text-black text-sm font-medium hover:bg-yellow-300 transition"
          >
            Add stick
          </button>
        </div>
      </div>
    </div>
  );
}
