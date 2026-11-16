#!/usr/bin/env python3
"""Build ISODOSE scan assets from open MRI/CT/PET data.

Inputs are expected in a local working directory (not committed):
  lh.pial, rh.pial                         FreeSurfer pial surfaces (ds003563, CC0)
  PhantomCT.nii                            cranial CT (Zenodo 3374839, CC BY 4.0)
  sub-004_ses-nx_trc-fdg_run-01_pet.nii.gz FDG PET (ds006917, CC0)

Outputs:
  assets/isodose/brain.bin
  assets/isodose/skull.bin
  assets/isodose/eyes.bin
  assets/isodose/lenses.bin
  assets/isodose/pet.bin

Binary formats:
  mesh:  b"ISOB" + u16 version + u16 kind(0) + u32 nv + u32 nf + f32[nv*3] + u32[nf*3]
  points:b"ISOP" + u16 version + u16 kind(1) + u32 count + f32[count*3] + f32[count]
All coordinates are in the ISODOSE patient frame: x=left, y=anterior, z=superior, mm.
"""
from __future__ import annotations

import argparse
import struct
from pathlib import Path

import nibabel as nib
import numpy as np
import trimesh
from scipy import ndimage
from skimage import measure


def read_fs_surface(path: Path) -> tuple[np.ndarray, np.ndarray]:
    b = path.read_bytes()
    if b[:3] != b"\xff\xff\xfe":
        raise ValueError(f"not a FreeSurfer surface: {path}")
    # 3-byte magic + 48-byte creation string, then two 4-byte counts.
    off = 51
    vnum = int.from_bytes(b[off:off + 4], "big")
    fnum = int.from_bytes(b[off + 4:off + 8], "big")
    off += 8
    verts = np.frombuffer(b, dtype=">f4", count=vnum * 3, offset=off).reshape(-1, 3)
    off += vnum * 12
    faces = np.frombuffer(b, dtype=">i4", count=fnum * 3, offset=off).reshape(-1, 3)
    return verts.astype(np.float64), faces.astype(np.int64)


def normalize_mesh(verts: np.ndarray, target_lo: np.ndarray, target_hi: np.ndarray) -> np.ndarray:
    lo = verts.min(axis=0)
    hi = verts.max(axis=0)
    scale = (target_hi - target_lo) / np.maximum(hi - lo, 1e-9)
    return target_lo + (verts - lo) * scale


def decimate(verts: np.ndarray, faces: np.ndarray, face_count: int) -> trimesh.Trimesh:
    mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=True)
    if len(mesh.faces) > face_count:
        mesh = mesh.simplify_quadric_decimation(face_count=face_count)
    mesh.remove_unreferenced_vertices()
    mesh.fix_normals()
    return mesh


def write_mesh(path: Path, mesh: trimesh.Trimesh) -> None:
    verts = np.asarray(mesh.vertices, dtype="<f4")
    faces = np.asarray(mesh.faces, dtype="<u4")
    header = b"ISOB" + struct.pack("<HHII", 1, 0, len(verts), len(faces))
    path.write_bytes(header + verts.tobytes() + faces.tobytes())
    print(f"{path.name}: {len(verts)} verts, {len(faces)} faces, {path.stat().st_size/1e6:.2f} MB")


def write_points(path: Path, points: np.ndarray, intensity: np.ndarray) -> None:
    pts = np.asarray(points, dtype="<f4")
    val = np.asarray(intensity, dtype="<f4")
    header = b"ISOP" + struct.pack("<HHI", 1, 1, len(pts))
    path.write_bytes(header + pts.tobytes() + val.tobytes())
    print(f"{path.name}: {len(pts)} points, {path.stat().st_size/1e6:.2f} MB")


def sphere_mesh(center: np.ndarray, radius: float, subdiv: int = 3) -> trimesh.Trimesh:
    m = trimesh.creation.icosphere(subdivisions=subdiv, radius=float(radius))
    m.apply_translation(center)
    return m


def ellipsoid_mesh(center: np.ndarray, radii: np.ndarray, subdiv: int = 3) -> trimesh.Trimesh:
    m = trimesh.creation.icosphere(subdivisions=subdiv, radius=1.0)
    m.apply_scale(radii)
    m.apply_translation(center)
    return m


def build_brain(src: Path, out: Path) -> None:
    vs, fs, nv = [], [], 0
    for name in ("lh.pial", "rh.pial"):
        v, f = read_fs_surface(src / name)
        vs.append(v)
        fs.append(f + nv)
        nv += len(v)
    v = np.vstack(vs)
    f = np.vstack(fs)
    # FreeSurfer RAS x=right; ISODOSE x=patient left.
    v[:, 0] *= -1
    target_lo = np.array([-56.0, -70.0, -18.0])
    target_hi = np.array([56.0, 70.0, 82.0])
    v = normalize_mesh(v, target_lo, target_hi)
    mesh = decimate(v, f, 50000)
    write_mesh(out / "brain.bin", mesh)


def build_skull(src: Path, out: Path) -> dict:
    img = nib.load(str(src / "PhantomCT.nii"))
    data = np.asarray(img.get_fdata(dtype=np.float32))[..., 0]
    mask = data > 300.0
    lab, n = ndimage.label(mask)
    if n:
        sizes = ndimage.sum(mask, lab, range(1, n + 1))
        mask = lab == (int(np.argmax(sizes)) + 1)
    mask = ndimage.binary_closing(mask, iterations=2)
    mask = ndimage.binary_fill_holes(mask)
    ds = 2
    small = mask[::ds, ::ds, ::ds]
    verts, faces, _, _ = measure.marching_cubes(small.astype(np.float32), level=0.5)
    vox = verts * ds
    hom = np.column_stack([vox, np.ones(len(vox))])
    world = (img.affine @ hom.T).T[:, :3]
    # CT LPS -> ISODOSE patient frame (x left, y anterior, z superior).
    iso = world * np.array([-1.0, 1.0, 1.0])
    lo, hi = iso.min(axis=0), iso.max(axis=0)
    center = (lo + hi) * 0.5
    target_center = np.array([0.0, 2.0, 30.0])
    target_extent = np.array([156.0, 190.0, 160.0])
    scale = float(np.min(target_extent / np.maximum(hi - lo, 1e-9)))
    verts = (iso - center) * scale + target_center
    mesh = decimate(verts, faces, 60000)
    write_mesh(out / "skull.bin", mesh)
    return {"world_center": center, "scale": scale, "target_center": target_center}


def ct_eye_assets(src: Path, out: Path, xf: dict) -> None:
    """Fit globes/lenses from the CT; keep them on the ISODOSE optic axis."""
    img = nib.load(str(src / "PhantomCT.nii"))
    data = np.asarray(img.get_fdata(dtype=np.float32))[..., 0]
    zooms = np.array(img.header.get_zooms()[:3], dtype=np.float64)
    inv = np.linalg.inv(img.affine)
    center = xf["world_center"]
    scale = xf["scale"]
    target_center = xf["target_center"]

    def iso_to_index(p):
        w = ((np.asarray(p, dtype=np.float64) - target_center) / scale + center) * np.array([-1.0, 1.0, 1.0])
        return (inv @ np.r_[w, 1.0])[:3]

    def index_to_iso(idx):
        w = (img.affine @ np.r_[np.asarray(idx, dtype=np.float64), 1.0])[:3]
        return (w * np.array([-1.0, 1.0, 1.0]) - center) * scale + target_center

    globes, lenses = [], []
    for sign in (-1, 1):
        ref_center = np.array([sign * 31.0, 63.0, 4.0])
        idx = iso_to_index(ref_center)
        rad_mm = 20.0
        rad_idx = np.maximum((rad_mm / zooms).astype(int), 3)
        c = np.round(idx).astype(int)
        sl = tuple(slice(max(0, c[i] - rad_idx[i]), min(data.shape[i], c[i] + rad_idx[i] + 1)) for i in range(3))
        sub = data[sl]
        m = (sub > -25.0) & (sub < 90.0)
        lab, n = ndimage.label(m)
        center_guess = np.array([c[i] - sl[i].start for i in range(3)])
        best, best_d = None, 1e9
        for k in range(1, n + 1):
            q = np.argwhere(lab == k)
            if len(q) < 800:
                continue
            d = np.linalg.norm(q.mean(axis=0) - center_guess)
            if d < best_d:
                best_d, best = d, q
        if best is not None:
            centroid_idx = best.mean(axis=0) + np.array([sl[i].start for i in range(3)])
            volume_mm3 = len(best) * float(np.prod(zooms))
            radius = float(np.clip((3.0 * volume_mm3 / (4.0 * np.pi)) ** (1.0 / 3.0), 8.0, 13.5))
            detected = index_to_iso(centroid_idx)
            # CT centroid can drift into orbital muscle; keep the optical axis.
            center_ref = ref_center * 0.7 + detected * 0.3
        else:
            center_ref = ref_center
            radius = 11.5
        globes.append(sphere_mesh(center_ref, radius, subdiv=3))
        lenses.append(ellipsoid_mesh(center_ref + np.array([0.0, 10.6, 0.0]), np.array([4.4, 2.0, 4.4]), subdiv=3))

    g = trimesh.util.concatenate(globes)
    l = trimesh.util.concatenate(lenses)
    write_mesh(out / "eyes.bin", g)
    write_mesh(out / "lenses.bin", l)

def build_pet(src: Path, out: Path) -> None:
    img = nib.load(str(src / "sub-004_ses-nx_trc-fdg_run-01_pet.nii.gz"))
    data = np.asarray(img.get_fdata(dtype=np.float32))
    # The head occupies the upper part of this reconstruction. Restrict to the
    # cranial block and take the high-uptake metabolic field.
    z0, z1 = int(data.shape[2] * 0.42), int(data.shape[2] * 0.94)
    sub = data[:, :, z0:z1]
    nz = sub[sub > 0]
    if nz.size == 0:
        raise ValueError("PET has no positive voxels in the cranial block")
    th = float(np.percentile(nz, 82.0))
    zz, yy, xx = np.where(sub > th)
    if len(xx) > 9000:
        pick = np.random.default_rng(0x150d05e).choice(len(xx), 9000, replace=False)
        xx, yy, zz = xx[pick], yy[pick], zz[pick]
    pts = np.column_stack([xx, yy, zz + z0]).astype(np.float64)
    # Normalize the metabolic cloud into the brain volume.
    target_lo = np.array([-52.0, -64.0, -12.0])
    target_hi = np.array([52.0, 64.0, 72.0])
    pts = normalize_mesh(pts, target_lo, target_hi)
    vals = sub[zz, yy, xx].astype(np.float64)
    vals = (vals - vals.min()) / max(vals.max() - vals.min(), 1e-9)
    write_points(out / "pet.bin", pts, vals)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, required=True)
    ap.add_argument("--out", type=Path, default=Path("assets/isodose"))
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    build_brain(args.src, args.out)
    xf = build_skull(args.src, args.out)
    ct_eye_assets(args.src, args.out, xf)
    build_pet(args.src, args.out)


if __name__ == "__main__":
    main()
