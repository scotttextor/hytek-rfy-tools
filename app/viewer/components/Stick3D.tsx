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
  //   - stickMidline.start / end are 2D elevation coords (mm). We
  //     interpret them as XY in 3D, with Z=0 being the elevation plane.
  //   - The stick is extruded along +Z in profile-extrude space, so we
  //     rotate so the extrusion axis aligns with (start → end) in XY,
  //     then translate the start point to the midline.start position.
  //   - Because the cross-section is centred on its web (y=0 in
  //     profile coords), the extrusion sits ON the elevation plane —
  //     i.e. the stick has visible depth INTO the page (the web
  //     dimension), which is exactly what we want for a 3D view.
  const angle = m.angle;  // angle of (end - start) in 2D XY
  // We need to rotate the geometry so its +Z extrusion points along (start → end).
  // ExtrudeGeometry's depth runs in +Z. Default we extrude in +Z.
  // Rotate -90° about Y to put the extrusion direction into +X, then
  // rotate further so +X aligns with our angle. Net: rotate so the
  // mesh's local +Z points along (cos(angle), sin(angle), 0).
  const quat = useMemo(() => {
    const target = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0).normalize();
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), target);
    return q;
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
