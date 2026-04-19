import sys
from pathlib import Path
import numpy as np

def update_retention():
    p = Path("python-proto/prototype_v11_mabr.py")
    c = p.read_text()
    start_marker = "def inject_triangular_retention_indent"
    end_marker = "def inject_slide_release_relief"
    
    start_idx = c.find(start_marker)
    end_idx = c.find(end_marker)
    
    fixed = """def inject_triangular_retention_indent(cavity_bin: np.ndarray, origin: np.ndarray, pitch: float,
                                       tg_data: dict, insertion_vox: int,
                                       front_offset_mm: float, length_mm: float,
                                       width_y_mm: float, depth_z_mm: float,
                                       y_offset_mm: float, both_sides: bool,
                                       rotate_deg: float = 0.0,
                                       corner_radius: float = 0.0,
                                       ) -> tuple[np.ndarray, np.ndarray]:
    import numpy as np
    nx, ny, nz = cavity_bin.shape
    cavity_f = cavity_bin.astype(np.float32)
    half_w = width_y_mm / 2.0
    if length_mm <= 0 or half_w <= 0 or depth_z_mm <= 0: return cavity_f, origin

    # 1. Coordinate Math
    tg_front_x = tg_data["bbox_min"][0]
    anchor_x = tg_front_x + front_offset_mm
    anchor_y = tg_data["center"][1] + y_offset_mm
    theta = np.radians(rotate_deg)
    ct, st = np.cos(theta), np.sin(theta)

    # 2. Rounded Triangle SDF setup
    r = min(corner_radius, half_w * 0.9, length_mm * 0.5)
    m = half_w / length_mm
    hyp = np.sqrt(half_w**2 + length_mm**2)
    n2 = np.array([half_w, length_mm]) / hyp # Normal to top side
    n3 = np.array([half_w, -length_mm]) / hyp # Normal to bottom side
    
    # Pre-calculate vertex interior angles for proper Voronoi region logic
    # Corner 1 (0, half_w), Corner 2 (0, -half_w), Corner 3 (length, 0)
    
    # 3. Carving Loop with SDF
    corners_uv = [(0.0, -half_w), (0.0, half_w), (length_mm, 0.0)]
    corner_gx = [anchor_x + u * ct - v * st for (u, v) in corners_uv]
    corner_gy = [anchor_y + u * st + v * ct for (u, v) in corners_uv]
    ci_vals = [insertion_vox - 1 - (g - origin[0]) / pitch for g in corner_gx]
    j_vals = [(g - origin[1]) / pitch for g in corner_gy]
    i_lo, i_hi = max(0, int(np.floor(min(ci_vals)))-2), min(nx-1, int(np.ceil(max(ci_vals)))+2)
    j_lo, j_hi = max(0, int(np.floor(min(j_vals)))-2), min(ny-1, int(np.ceil(max(j_vals)))+2)

    for i in range(i_lo, i_hi + 1):
        gx = origin[0] + (insertion_vox - 1 - i) * pitch
        for j in range(j_lo, j_hi + 1):
            gy = origin[1] + (j + 0.5) * pitch
            du, dv = gx - anchor_x, gy - anchor_y
            u = du * ct + dv * st
            v = -du * st + dy * ct
            
            # Sharp SDF lines
            d1 = -u 
            d2 = (u * n2[0] + (v - half_w) * n2[1])
            d3 = (u * n3[0] + (v + half_w) * n3[1])
            
            if r <= 0:
                dist = max(d1, d2, d3)
            else:
                # Proper rounded triangle SDF
                sd1, sd2, sd3 = d1 + r, d2 + r, d3 + r
                dist_shrunken = max(sd1, sd2, sd3)
                
                if dist_shrunken <= 0:
                    dist = dist_shrunken - r
                else:
                    # In Voronoi regions of vertices or outside edges
                    # A more robust convex hull SDF:
                    dist = dist_shrunken - r
                    # Check corners explicitly
                    if sd1 > 0 and sd2 > 0: dist = np.sqrt(sd1**2 + sd2**2) - r
                    elif sd1 > 0 and sd3 > 0: dist = np.sqrt(sd1**2 + sd3**2) - r
                    elif sd2 > 0 and sd3 > 0: dist = np.sqrt(sd2**2 + sd3**2) - r

            if dist > 0: continue
            
            v_cov = 1.0
            if dist > -pitch: v_cov = abs(dist) / pitch
            
            frac = max(0, 1.0 - u / length_mm)
            depth_vox = (depth_z_mm * frac) / pitch
            z_full, z_frac = int(np.floor(depth_vox)), depth_vox - np.floor(depth_vox)
            
            col = cavity_bin[i, j, :]
            if not col.any(): continue
            zs = np.where(col)[0]
            z_max, z_min = int(zs.max()), int(zs.min())
            
            for k_off in range(z_full + 1):
                dens = v_cov
                if k_off > depth_vox: continue
                if k_off + 1 > depth_vox: dens *= z_frac
                
                idx = z_max - k_off
                if z_min <= idx <= z_max:
                    nv = 1.0 - dens
                    if cavity_f[i, j, idx] > nv: cavity_f[i, j, idx] = nv
                
                if both_sides:
                    idx = z_min + k_off
                    if z_min <= idx <= z_max:
                        nv = 1.0 - dens
                        if cavity_f[i, j, idx] > nv: cavity_f[i, j, idx] = nv

    return cavity_f, origin

"""
    p.write_text(c[:start_idx] + fixed + c[end_idx:])

if __name__ == "__main__":
    update_retention()
