// Wall3D — Three.js scene rendered into a Canvas. Same role as Wall.tsx
// but renders the frame's sticks as extruded C-section meshes that the
// user can rotate / pan / zoom freely with OrbitControls.
//
// View-only for now (Phase B per the design). Stick selection works
// via raycast click; the existing 2D editing actions (add op, drag,
// etc.) only fire in 2D mode. Tool ops are NOT rendered yet (Phase 2 —
// decals on stick surfaces).

"use client";
import { useMemo, useRef, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import { useViewerStore } from "../store";
import { Stick3D } from "./Stick3D";
import { frameBBox } from "../lib/geometry";

export function Wall3D() {
  const doc = useViewerStore((s) => s.doc);
  const selectedPlanIdx = useViewerStore((s) => s.selectedPlanIdx);
  const selectedFrameIdx = useViewerStore((s) => s.selectedFrameIdx);
  const selectedStickKey = useViewerStore((s) => s.selectedStickKey);
  const selectStick = useViewerStore((s) => s.selectStick);

  const frame = doc?.project.plans[selectedPlanIdx]?.frames[selectedFrameIdx];

  // Camera target = centre of the frame's bbox so OrbitControls rotates
  // around the visible content rather than the world origin.
  const cameraTarget = useMemo<[number, number, number]>(() => {
    if (!frame) return [0, 0, 0];
    const bb = frameBBox(frame);
    if (!bb) return [0, 0, 0];
    return [(bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2, 0];
  }, [frame]);

  // Camera distance auto-fits the frame on switch.
  const cameraDistance = useMemo(() => {
    if (!frame) return 5000;
    const bb = frameBBox(frame);
    if (!bb) return 5000;
    const w = bb.maxX - bb.minX;
    const h = bb.maxY - bb.minY;
    return Math.max(w, h) * 1.3;
  }, [frame]);

  const orbitRef = useRef<{ target: { set: (x: number, y: number, z: number) => void }; update: () => void } | null>(null);
  useEffect(() => {
    if (orbitRef.current) {
      orbitRef.current.target.set(cameraTarget[0], cameraTarget[1], cameraTarget[2]);
      orbitRef.current.update();
    }
  }, [cameraTarget]);

  if (!doc || !frame) {
    return (
      <div className="w-full h-full bg-zinc-950 relative overflow-hidden flex items-center justify-center">
        <div className="text-center">
          <div className="text-zinc-600 text-sm uppercase tracking-wider mb-2">3D View</div>
          <div className="text-zinc-400">Drop a .rfy file to load a job</div>
        </div>
      </div>
    );
  }

  return (
    // w-full h-full (not flex-1) so the Canvas's parent has explicit
    // dimensions. r3f Canvas defaults to width:100%/height:100% which
    // needs a sized parent — flex-1 on a non-flex parent gives 0.
    <div className="w-full h-full bg-zinc-950 relative overflow-hidden">
      <Canvas
        shadows
        // Click empty canvas → deselect. Stops on mesh clicks because
        // Stick3D calls e.stopPropagation in its onClick.
        onPointerMissed={() => selectStick(null)}
      >
        <PerspectiveCamera
          makeDefault
          fov={45}
          near={1}
          far={cameraDistance * 10}
          position={[cameraTarget[0], cameraTarget[1], cameraDistance]}
        />
        <OrbitControls
          ref={(r) => { orbitRef.current = r as unknown as typeof orbitRef.current; }}
          enableDamping
          dampingFactor={0.1}
          target={cameraTarget}
          panSpeed={1.5}
          zoomSpeed={1.2}
        />

        {/* Ambient + directional lighting. The directional light gives the
            steel meshes a clear specular highlight so the C-section flange
            edges read at any rotation. */}
        <ambientLight intensity={0.5} />
        <directionalLight
          position={[cameraDistance * 0.6, cameraDistance * 0.6, cameraDistance * 0.8]}
          intensity={1.2}
          castShadow
        />
        <directionalLight
          position={[-cameraDistance * 0.4, -cameraDistance * 0.3, cameraDistance * 0.4]}
          intensity={0.5}
        />

        {/* Subtle ground plane at z=-100 to give a sense of vertical
            (helps the user orient themselves when rotating). */}
        <mesh position={[cameraTarget[0], cameraTarget[1], -100]} rotation={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[cameraDistance * 4, cameraDistance * 4]} />
          <meshStandardMaterial color="#0a0a0a" roughness={1} metalness={0} />
        </mesh>

        {/* Sticks — each rendered by Stick3D as an extruded C-section.
            The frame's elevation 2D coords map directly to world XY in
            3D space; depth (web dimension) extends along +Z out of the
            elevation plane. */}
        {frame.sticks.map((stick, i) => {
          const key = `${selectedFrameIdx}-${i}`;
          return (
            <Stick3D
              key={key}
              stick={stick}
              stickKey={key}
              selected={selectedStickKey === key}
              onSelect={selectStick}
            />
          );
        })}
      </Canvas>

      {/* Status bar — same style as the 2D Wall. Tells the user what
          gestures work in 3D mode. */}
      <div className="absolute bottom-0 left-0 right-0 px-4 py-2 bg-zinc-900/80 border-t border-zinc-800 text-xs text-zinc-400 flex items-center justify-between pointer-events-none">
        <span>
          <span className="text-yellow-400 font-mono">{frame.name}</span>
          {" · "}
          {frame.sticks.length} sticks · {frame.sticks.reduce((s, x) => s + x.tooling.length, 0)} ops
          {" · "}
          <span className="text-amber-400">3D view (read-only)</span>
        </span>
        <span>drag = orbit · right-drag = pan · wheel = zoom · click stick = select</span>
      </div>
    </div>
  );
}
