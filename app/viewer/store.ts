// Wall viewer state — Zustand store mirroring the loaded RfyDocument plus
// UI-only state (selection, camera, undo history). All edits go through
// store actions which snapshot history before mutating.
//
// Every edit:
//   1. Pushes the current `doc` onto `history` (cleared `future`)
//   2. Calls a pure edit transform from lib/edits.ts to produce a new doc
//   3. Sets `doc = newDoc; dirty = true`
//
// Undo / redo move the doc between `history` and `future` stacks.

import { create } from "zustand";
import type { RfyDocument, RfyToolingOp } from "@hytek/rfy-codec";
import {
  addOp as editAddOp,
  removeOp as editRemoveOp,
  updateOpPos as editUpdateOpPos,
  moveStick as editMoveStick,
  moveStickEnd as editMoveStickEnd,
  parseStickKey,
} from "./lib/edits";

const MAX_HISTORY = 100;

export interface ViewerState {
  doc: RfyDocument | null;
  filename: string | null;

  selectedPlanIdx: number;
  selectedFrameIdx: number;
  selectedStickKey: string | null;
  selectedOpIdx: number | null;

  zoom: number;
  panX: number;
  panY: number;

  history: RfyDocument[];
  future: RfyDocument[];
  dirty: boolean;

  // Loaders
  loadDoc: (doc: RfyDocument, filename: string) => void;
  reset: () => void;

  // Navigation
  selectPlan: (idx: number) => void;
  selectFrame: (idx: number) => void;
  selectStick: (key: string | null) => void;
  selectOp: (idx: number | null) => void;
  setZoom: (zoom: number) => void;
  setPan: (panX: number, panY: number) => void;

  // Edits
  addOp: (stickKey: string, op: RfyToolingOp) => void;
  removeOp: (stickKey: string, opIdx: number) => void;
  updateOpPos: (stickKey: string, opIdx: number, newPos: number) => void;
  moveStick: (stickKey: string, dx: number, dy: number) => void;
  moveStickEnd: (stickKey: string, endIdx: 0 | 1, dx: number, dy: number) => void;

  // History
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

const initialState = {
  doc: null,
  filename: null,
  selectedPlanIdx: 0,
  selectedFrameIdx: 0,
  selectedStickKey: null,
  selectedOpIdx: null,
  zoom: 1,
  panX: 0,
  panY: 0,
  history: [],
  future: [],
  dirty: false,
};

export const useViewerStore = create<ViewerState>((set, get) => {
  // Helper: snapshot before mutating. Caps history at MAX_HISTORY entries.
  function snapshot(): RfyDocument[] {
    const cur = get().doc;
    if (!cur) return [];
    const h = [...get().history, cur];
    if (h.length > MAX_HISTORY) h.shift();
    return h;
  }

  return {
    ...initialState,

    loadDoc: (doc, filename) =>
      set({
        doc, filename,
        selectedPlanIdx: 0, selectedFrameIdx: 0,
        selectedStickKey: null, selectedOpIdx: null,
        history: [], future: [], dirty: false,
        zoom: 1, panX: 0, panY: 0,
      }),

    reset: () => set(initialState),

    selectPlan: (idx) => set({ selectedPlanIdx: idx, selectedFrameIdx: 0, selectedStickKey: null, selectedOpIdx: null }),
    selectFrame: (idx) => set({ selectedFrameIdx: idx, selectedStickKey: null, selectedOpIdx: null }),
    selectStick: (key) => set({ selectedStickKey: key, selectedOpIdx: null }),
    selectOp: (idx) => set({ selectedOpIdx: idx }),
    setZoom: (zoom) => set({ zoom }),
    setPan: (panX, panY) => set({ panX, panY }),

    addOp: (stickKey, op) => {
      const { doc, selectedPlanIdx } = get();
      if (!doc) return;
      const addr = parseStickKey(stickKey, selectedPlanIdx);
      if (!addr) return;
      const next = editAddOp(doc, addr, op);
      set({ doc: next, history: snapshot(), future: [], dirty: true });
    },

    removeOp: (stickKey, opIdx) => {
      const { doc, selectedPlanIdx } = get();
      if (!doc) return;
      const addr = parseStickKey(stickKey, selectedPlanIdx);
      if (!addr) return;
      const next = editRemoveOp(doc, addr, opIdx);
      set({ doc: next, history: snapshot(), future: [], dirty: true, selectedOpIdx: null });
    },

    updateOpPos: (stickKey, opIdx, newPos) => {
      const { doc, selectedPlanIdx } = get();
      if (!doc) return;
      const addr = parseStickKey(stickKey, selectedPlanIdx);
      if (!addr) return;
      const next = editUpdateOpPos(doc, addr, opIdx, newPos);
      set({ doc: next, history: snapshot(), future: [], dirty: true });
    },

    moveStick: (stickKey, dx, dy) => {
      const { doc, selectedPlanIdx } = get();
      if (!doc) return;
      const addr = parseStickKey(stickKey, selectedPlanIdx);
      if (!addr) return;
      const next = editMoveStick(doc, addr, dx, dy);
      set({ doc: next, history: snapshot(), future: [], dirty: true });
    },

    moveStickEnd: (stickKey, endIdx, dx, dy) => {
      const { doc, selectedPlanIdx } = get();
      if (!doc) return;
      const addr = parseStickKey(stickKey, selectedPlanIdx);
      if (!addr) return;
      const next = editMoveStickEnd(doc, addr, endIdx, dx, dy);
      set({ doc: next, history: snapshot(), future: [], dirty: true });
    },

    undo: () => {
      const { history, doc } = get();
      if (history.length === 0 || !doc) return;
      const prev = history[history.length - 1]!;
      set({
        doc: prev,
        history: history.slice(0, -1),
        future: [doc, ...get().future],
        dirty: true,
      });
    },

    redo: () => {
      const { future, doc } = get();
      if (future.length === 0 || !doc) return;
      const nxt = future[0]!;
      set({
        doc: nxt,
        history: [...get().history, doc],
        future: future.slice(1),
        dirty: true,
      });
    },

    canUndo: () => get().history.length > 0,
    canRedo: () => get().future.length > 0,
  };
});
