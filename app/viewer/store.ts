// Wall viewer state — Zustand store mirroring the loaded RfyDocument plus
// UI-only state (selection, camera, undo history). All edits go through
// store actions which snapshot history before mutating.
//
// Keep this file pure-data-management. Rendering decisions and DOM
// interactions live in the components. Pure edit transforms live in
// app/viewer/lib/edits.ts so they can be unit-tested without React.

import { create } from "zustand";
import type { RfyDocument } from "@hytek/rfy-codec";

export interface ViewerState {
  // Loaded document
  doc: RfyDocument | null;
  filename: string | null;

  // Navigation
  selectedPlanIdx: number;
  selectedFrameIdx: number;
  selectedStickKey: string | null;  // `${frameIdx}-${stickIdx}`

  // Camera (for pan/zoom — applied as CSS transform on the SVG group)
  zoom: number;
  panX: number;
  panY: number;

  // Edit history. We snapshot the entire `doc` before each mutation so
  // undo is trivial. RfyDocument is JSON-serialisable so structuredClone
  // gives us cheap deep copies. For very large documents (40+ frames),
  // we may need to switch to immer-style structural sharing later — but
  // for one-frame-at-a-time editing this is fine.
  history: RfyDocument[];
  future: RfyDocument[];
  dirty: boolean;

  // Actions
  loadDoc: (doc: RfyDocument, filename: string) => void;
  selectPlan: (idx: number) => void;
  selectFrame: (idx: number) => void;
  selectStick: (key: string | null) => void;
  setZoom: (zoom: number) => void;
  setPan: (panX: number, panY: number) => void;
  // Edit actions are added as Phase 2-5 land. For now, just navigation.
  reset: () => void;
}

const initialState = {
  doc: null,
  filename: null,
  selectedPlanIdx: 0,
  selectedFrameIdx: 0,
  selectedStickKey: null,
  zoom: 1,
  panX: 0,
  panY: 0,
  history: [],
  future: [],
  dirty: false,
};

export const useViewerStore = create<ViewerState>((set) => ({
  ...initialState,

  loadDoc: (doc, filename) =>
    set({
      doc,
      filename,
      selectedPlanIdx: 0,
      selectedFrameIdx: 0,
      selectedStickKey: null,
      history: [],
      future: [],
      dirty: false,
      // Reset camera so the new doc is centred
      zoom: 1,
      panX: 0,
      panY: 0,
    }),

  selectPlan: (idx) => set({ selectedPlanIdx: idx, selectedFrameIdx: 0, selectedStickKey: null }),
  selectFrame: (idx) => set({ selectedFrameIdx: idx, selectedStickKey: null }),
  selectStick: (key) => set({ selectedStickKey: key }),
  setZoom: (zoom) => set({ zoom }),
  setPan: (panX, panY) => set({ panX, panY }),

  reset: () => set(initialState),
}));
