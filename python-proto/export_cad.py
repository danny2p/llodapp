"""Export procedurally generated features as clean CAD geometry (STEP).

Uses CadQuery to build B-Rep solids that exactly match the voxel carvers.
Everything is positioned in HAS (Holster Alignment System) world space.
"""

import os
import json
import argparse
import cadquery as cq
import numpy as np
from pathlib import Path
from features_frame import flf_from_points, HAS_DEFAULT_R, rot_z

def export_generic_cut(state, meta):
    vals = state.get("values", {})
    w = float(vals.get("width", 7.0))
    h = float(vals.get("height", 7.0))
    d = float(vals.get("depth", 5.0))
    rz_deg = float(vals.get("rotateZ", 0.0))
    chamfer = float(vals.get("chamfer", 1.0))
    ox = float(vals.get("offsetX", 0.0))
    oy = float(vals.get("offsetY", 0.0))
    
    pts = state.get("points", [])
    flf = flf_from_points(pts)
    if not flf: return None
        
    p0 = flf.origin
    # Anchor: handle muzzle-ward, box rear-ward
    base_x = 10.0 + w / 2.0
    base_y = -h / 2.0
    local_offset = np.array([base_x + ox, base_y + oy, 0.0])
    world_center = p0 + np.dot(flf.R, local_offset)
    
    res = cq.Workplane("XY").box(w, h, d)
    if chamfer > 0.01:
        res = res.edges("|Y and <Z").chamfer(chamfer)

    R_total = flf.R
    rad = np.radians(rz_deg)
    R_local = np.array([
        [np.cos(rad), -np.sin(rad), 0],
        [np.sin(rad),  np.cos(rad), 0],
        [0,            0,           1]
    ])
    R_final = np.dot(R_total, R_local)
    
    new_plane = cq.Plane(
        origin=cq.Vector(*world_center),
        xDir=cq.Vector(*R_final[:, 0]),
        normal=cq.Vector(*R_final[:, 2])
    )
    return res.val().moved(new_plane.location)

def export_trigger_platen(state, meta):
    vals = state.get("values", {})
    thickness = float(vals.get("thickness", 4.0))
    
    total_length = meta["total_length"]
    muzzle_x = meta["muzzle_x"]
    y_min = meta["y_min"]
    y_max = meta["y_max"]
    muzzle_extension = meta.get("muzzle_extension", 0.0)
    
    w = max(1.0, (total_length - 30.0) + muzzle_extension)
    h = max(1.0, (y_max - 15.0) - y_min)
    d = thickness
    
    pos_x = muzzle_x - w / 2.0
    pos_y = y_min + h / 2.0
    # Z: One-directional growth from midplane (Z=0)
    pos_z = d / 2.0 
    
    res = cq.Workplane("XY").box(w, h, d)
    final_solid = res.translate((pos_x, pos_y, pos_z))
    return final_solid.val()

def export_gun_band(state, meta):
    vals   = state.get("values", {})
    points = state.get("points", [])
    if len(points) < 2: return None

    width         = float(vals.get("width",         20.0))
    depth_z       = float(vals.get("depthZ",        10.0))
    extend_top    = float(vals.get("extendTop",     12.0))
    extend_bot    = float(vals.get("extendBottom",   0.0))
    offset_x      = float(vals.get("offsetX",        0.0))
    offset_y      = float(vals.get("offsetY",        0.0))
    chamfer       = float(vals.get("chamfer",        1.0))

    p0_raw = np.asarray(points[0], dtype=float) + np.array([offset_x, offset_y, 0.0])
    p1_raw = np.asarray(points[1], dtype=float) + np.array([offset_x, offset_y, 0.0])
    edge_vec_raw = p1_raw - p0_raw
    edge_len_raw = float(np.linalg.norm(edge_vec_raw))
    if edge_len_raw < 1e-6: return None
    edge_dir = edge_vec_raw / edge_len_raw

    p0 = p0_raw - edge_dir * extend_top
    p1 = p1_raw + edge_dir * extend_bot
    
    z_mid_pts = (p0[2] + p1[2]) / 2.0
    is_positive = z_mid_pts >= 0.0
    z_sign = 1.0 if is_positive else -1.0
    
    z_mean = (p0_raw[2] + p1_raw[2]) / 2.0
    z_front_plane = z_mean + z_sign * depth_z
    
    poly = [
        (p0[0], p0[1]),
        (p1[0], p1[1]),
        (p1[0] - width, p1[1]),
        (p0[0] - width, p0[1])
    ]
    
    res = cq.Workplane("XY").polyline(poly).close().extrude(z_front_plane)
    
    if chamfer > 0.01:
        try:
            res = res.faces(">Z").edges("|X").chamfer(chamfer)
        except:
            pass

    return res.val()

def export_trigger_retention(state, meta):
    v = state.get("values", {})
    pts = state.get("points", [])
    if not pts or pts[0] is None: return None
    
    front_offset = float(v.get("frontOffset", 4.0))
    length = float(v.get("length", 16.0))
    width_y = float(v.get("widthY", 14.0))
    depth_z = float(v.get("depthZ", 4.0))
    y_offset = float(v.get("yOffset", 0.0))
    rz_deg = float(v.get("rotateZDeg", 0.0))
    one_side = bool(v.get("oneSide", False))
    chamfer = float(v.get("chamfer", 2.0))
    
    flf = flf_from_points(pts)
    if not flf: return None
    
    half_w = width_y / 2.0
    poly = [
        (0.0, half_w),
        (0.0, -half_w),
        (length, 0.0)
    ]
    
    if one_side:
        res = cq.Workplane("XY").polyline(poly).close().extrude(depth_z)
    else:
        res = cq.Workplane("XY").polyline(poly).close().extrude(depth_z, both=True)
        
    if chamfer > 0.01:
        try:
            res = res.edges().chamfer(min(chamfer, half_w - 0.1))
        except:
            pass

    rad = np.radians(rz_deg)
    R_local = np.array([
        [np.cos(rad), -np.sin(rad), 0],
        [np.sin(rad),  np.cos(rad), 0],
        [0,            0,           1]
    ])
    R_final = np.dot(flf.R, R_local)
    
    # Offset is translated by FLF rotation (not local rotation), matching the UI
    anchor_world = flf.origin + np.dot(flf.R, np.array([front_offset, y_offset, 0.0]))
    
    new_plane = cq.Plane(
        origin=cq.Vector(*anchor_world),
        xDir=cq.Vector(*R_final[:, 0]),
        normal=cq.Vector(*R_final[:, 2])
    )
    return res.val().moved(new_plane.location)

def export_slide_release(state, meta):
    v = state.get("values", {})
    pts = state.get("points", [])
    if not pts or not isinstance(pts, list) or pts[0] is None: 
        return None
    
    anchor = np.asarray(pts[0], dtype=float)
    w = float(v.get("widthY", 12.0))
    d = float(v.get("depthZ", 6.0))
    y_off = float(v.get("yOffset", 0.0))
    chamfer = float(v.get("chamfer", 2.0))
    
    total_length = meta["total_length"]
    muzzle_x = meta["muzzle_x"]
    entrance_x = muzzle_x - total_length
    
    channel_len = max(1.0, anchor[0] - entrance_x)
    pos_x = entrance_x + channel_len / 2.0
    pos_y = anchor[1] + y_off
    
    z_sign = 1.0 if anchor[2] >= 0 else -1.0
    pos_z = anchor[2] + (z_sign * d / 2.0)
    
    res = cq.Workplane("XY").box(channel_len, w, d)
    
    if chamfer > 0.01:
        try:
            face_sel = ">Z" if z_sign > 0 else "<Z"
            res = res.faces(face_sel).edges("|X").chamfer(chamfer)
        except:
            pass

    return res.translate((pos_x, pos_y, pos_z)).val()

def export_slide_circles(state, meta):
    vals = state.get("values", {})
    outer_rad = float(vals.get("outerDia", 10.0)) / 2.0
    inner_rad = float(vals.get("innerDia", 2.0)) / 2.0
    spacing = float(vals.get("spacing", 30.0))
    height = float(vals.get("height", 6.0))
    rz_deg = float(vals.get("rotateZ", 0.0))
    
    pts = state.get("points", [])
    if not pts or pts[0] is None: return None

    flf = flf_from_points(pts)
    if flf is None: return None
    p0 = flf.origin

    R_total = flf.R @ rot_z(np.radians(rz_deg))
    
    solids = []
    for i in range(3):
        center_local = np.array([i * spacing, 0.0, 0.0])
        center_world = p0 + R_total @ center_local
        outer = cq.Workplane("XY").circle(outer_rad).extrude(height)
        inner = cq.Workplane("XY").circle(inner_rad).extrude(height + 1.0)
        z_sign = 1.0 if p0[2] >= 0 else -1.0
        new_plane = cq.Plane(
            origin=cq.Vector(*center_world),
            xDir=cq.Vector(*R_total[:, 0]),
            normal=cq.Vector(0, 0, z_sign)
        )
        comp = outer.union(inner)
        solids.append(comp.val().moved(new_plane.location))
        
    if not solids: return None
    res = solids[0]
    for s in solids[1:]:
        res = res.fuse(s)
    return res

def export_sight_channel(state, meta):
    v = state.get("values", {})
    h = float(v.get("height", 10.0))
    w = float(v.get("width", 4.0))
    length = float(v.get("length", 160.0))
    ox = float(v.get("offsetX", -19.0))
    oy = float(v.get("offsetY", 0.0))
    rz = float(v.get("rotateZ", 0.0))

    muzzle_x = meta["muzzle_x"]
    slide_top_y = meta.get("slide_top_y", meta["y_max"])
    
    res = cq.Workplane("XY").box(length, h, w)
    local_y = h / 2.0 + oy
    local_x = length / 2.0 - ox
    res = res.translate((local_x, local_y, 0))
    
    rad = np.radians(rz)
    R_local = np.array([
        [np.cos(rad), -np.sin(rad), 0],
        [np.sin(rad),  np.cos(rad), 0],
        [0,            0,           1]
    ])
    R_total = np.dot(HAS_DEFAULT_R, R_local)
    
    new_plane = cq.Plane(
        origin=cq.Vector(muzzle_x, slide_top_y, 0),
        xDir=cq.Vector(*R_total[:, 0]),
        normal=cq.Vector(*R_total[:, 2])
    )
    return res.val().moved(new_plane.location)

def export_nub(state, meta):
    vals = state.get("values", {})
    dia = float(vals.get("diameter", 5.0))
    height = float(vals.get("height", 3.0))
    
    pts = state.get("points", [])
    flf = flf_from_points(pts)
    if not flf: return None
    
    # Simple cylinder aligned to local Z
    res = cq.Workplane("XY").circle(dia / 2.0).extrude(height)
    
    new_plane = cq.Plane(
        origin=cq.Vector(*flf.origin),
        xDir=cq.Vector(*flf.R[:, 0]),
        normal=cq.Vector(*flf.R[:, 2])
    )
    return res.val().moved(new_plane.location)

def export_muzzle_cut(state, meta, stl_path=None):
    vals = state.get("values", {})
    extension = float(vals.get("extension", 30.0))
    pts = state.get("points", [])
    if not pts or pts[0] is None: return None
    
    cut_x = float(pts[0][0])
    
    # Approximate muzzle footprint using a box matching the mesh bounding box at cut_x
    w_y, w_z = 40.0, 30.0 # Fallbacks
    center_y, center_z = 0.0, 0.0
    
    if stl_path and os.path.exists(stl_path):
        try:
            import trimesh
            mesh = trimesh.load_mesh(stl_path, process=False)
            mask = np.abs(mesh.vertices[:, 0] - cut_x) < 1.0
            if np.any(mask):
                v_slice = mesh.vertices[mask]
                ymin, zmin = v_slice[:, 1].min(), v_slice[:, 2].min()
                ymax, zmax = v_slice[:, 1].max(), v_slice[:, 2].max()
                w_y = (ymax - ymin) + 2.0
                w_z = (zmax - zmin) + 2.0
                center_y = (ymin + ymax) / 2.0
                center_z = (zmin + zmax) / 2.0
        except Exception as e:
            print(f"Warning: failed to compute muzzle footprint: {e}", flush=True)

    pos_x = cut_x + extension / 2.0
    res = cq.Workplane("XY").box(extension, w_y, w_z)
    return res.translate((pos_x, center_y, center_z)).val()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-dir", type=str, required=True)
    parser.add_argument("--stl-path", type=str, required=False)
    parser.add_argument("--plug-path", type=str, required=False)
    args = parser.parse_args()
    
    job_dir = Path(args.job_dir)
    features_path = job_dir / "features_state.json"
    meta_path = job_dir / "meta.json"
    
    if not features_path.exists():
        raise FileNotFoundError(f"{features_path} not found")
    if not meta_path.exists():
        raise FileNotFoundError(f"{meta_path} not found. Please re-run 'Create Split Molds' to generate metadata.")
        
    with open(features_path) as f:
        features_state = json.load(f)
    with open(meta_path) as f:
        meta = json.load(f)
    
    assembly = cq.Assembly()
    
    for fid, instances in features_state.items():
        if not isinstance(instances, list):
            instances = [instances]
            
        for idx, state in enumerate(instances):
            is_enabled = state.get("enabled", False)
            if not is_enabled:
                continue
                
            solid = None
            if fid == "generic_cut":
                solid = export_generic_cut(state, meta)
            elif fid == "trigger_platen":
                solid = export_trigger_platen(state, meta)
            elif fid == "gun_band":
                solid = export_gun_band(state, meta)
            elif fid == "trigger_retention":
                solid = export_trigger_retention(state, meta)
            elif fid == "slide_release":
                solid = export_slide_release(state, meta)
            elif fid == "slide_circles":
                solid = export_slide_circles(state, meta)
            elif fid == "sight_channel":
                solid = export_sight_channel(state, meta)
            elif fid == "nub":
                solid = export_nub(state, meta)
            elif fid == "muzzle_cut":
                solid = export_muzzle_cut(state, meta, args.stl_path)
            
            if solid:
                assembly.add(solid, name=f"{fid}_{idx}")
                
    out_path = job_dir / "features.step"
    assembly.save(str(out_path), "STEP")
    print(f"Exported CAD assembly to {out_path}", flush=True)

if __name__ == "__main__":
    main()
