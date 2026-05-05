// Stick3D — single stick rendered as a real extruded C-section mesh.
//
// Uses THREE.ExtrudeGeometry to extrude the 2D profile cross-section
// (from lib/profile-extrude.ts) along the stick's length axis. The
// stick's orientation in 3D space is derived from its outline corners
// (same midline computation as the 2D Stick component).

"use client";
import { useMemo } from "react";
import * as THREE from "three";
import type { RfyStick } from "@hytek/rfy-codec";
import { stickMidline } from "../lib/geometry";
import { profileShape } from "../lib/profile-extrude";

interface Stick3DProps {
  stick: RfyStick;
  stickKey: string;
  selected: boolean;
  onSelect: (key: string) => void;
}

export function Stick3D({ stick, stickKey, selected, onSelect }: Stick3DProps) {
  const m = stickMidline(stick);

  // Build the geometry once per stick. Memoised so React doesn't
  // rebuild on every frame.
  const geometry = useMemo(() => {
    if (!m) return null;
    const ps = profileShape(stick.profile);
    const shape = new THREE.Shape(ps.outer.map((p) => new THREE.Vector2(p.x, p.y)));
    return new THREE.ExtrudeGeometry(shape, {
      depth: m.length,
      bevelEnabled: false,
    });
  }, [stick.profile.web, stick.profile.lFlange, stick.profile.rFlange, stick.profile.lip, stick.profile.gauge, m?.length]);

  if (!m || !geometry) return null;

  // Position + orient the stick in 3D world space.
  //
  // Profile axes (from lib/profile-extrude.ts):
  //   profile +X = flange depth (out of the C, towards the lips)
  //   profile +Y = web height (along the long dimension of the C-section)
  //   profile +Z = extrusion direction (along stick length)
  //
  // For an "On Flat" elevation view (the standard wall/joist/truss
  // convention per the FrameCAD manual section 4.4), we want:
  //   profile +X → world +Z   (flange depth points TOWARDS the viewer)
  //   profile +Z → world stickAxis  (extrusion follows stick length)
  //   profile +Y is derived: Y = Z × X (right-handed)
  //
  // Without explicit rotation about the length axis, the previous
  // setFromUnitVectors approach picked an arbitrary perpendicular —
  // chord webs ended up facing sideways while web members stayed
  // flat, producing the inconsistent rendering Scott flagged
  // 2026-05-05 on the TIN truss view.
  const angle = m.angle;
  const quat = useMemo(() => {
    const stickAxis = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
    const flangeDir = new THREE.Vector3(0, 0, 1);  // always towards viewer
    const webHeightDir = new THREE.Vector3().crossVectors(stickAxis, flangeDir);  // = Z × X = Y
    const m4 = new THREE.Matrix4().makeBasis(flangeDir, webHeightDir, stickAxis);
    return new THREE.Quaternion().setFromRotationMatrix(m4);
  }, [angle]);

  const colour = selected ? "#FFCB05" : "#a8a8b0";

  return (
    <mesh
      geometry={geometry}
      position={[m.start.x, m.start.y, 0]}
      quaternion={quat}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(stickKey);
      }}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial
        color={colour}
        metalness={0.7}
        roughness={0.4}
        emissive={selected ? "#FFCB05" : "#000000"}
        emissiveIntensity={selected ? 0.15 : 0}
      />
    </mesh>
  );
}
