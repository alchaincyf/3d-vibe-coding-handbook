# -*- coding: utf-8 -*-
"""E10：数一个 FBX 里四边形/三角形/N 边形各占多少。
解析器直接复用 P2.0实测-20260911/_probe_fbx.py，不另写一份。
用法: python3 e10_topology.py <a.fbx> [b.fbx ...]
"""
import struct, sys, os, collections

PROBE = os.path.expanduser(
    "~/Documents/写作/03-视频创作/项目/2026.09-Tripo GPT-6 Astra商单/"
    "调研/实测记录/P2.0实测-20260911/_probe_fbx.py")
_src = open(PROBE, encoding="utf-8").read().split("path = sys.argv[1]")[0]
_ns = {}
exec(compile(_src, PROBE, "exec"), _ns)
parse = _ns["parse"]


def find_array(node, child_name):
    for c in node.children:
        if c.name == child_name:
            for p in c.props:
                if isinstance(p, tuple) and p[0] == "ARRAY":
                    return p
    return None


def report(path):
    b = open(path, "rb").read()
    assert b[:21] == b"Kaydara FBX Binary  \x00", "不是二进制 FBX"
    ver = struct.unpack_from("<I", b, 23)[0]
    root, _ = parse(b, 27, ver)
    objs = {n.name: n for n in root}.get("Objects")
    hist = collections.Counter()
    verts = 0
    for g in [c for c in objs.children if c.name == "Geometry"]:
        va = find_array(g, "Vertices")
        pa = find_array(g, "PolygonVertexIndex")
        if va:
            verts += va[2] // 3
        if not pa or pa[3] is None:
            continue
        idx = struct.unpack("<%d%s" % (pa[2], pa[4]), pa[3][: pa[2] * 4])
        n = 0
        for x in idx:
            n += 1
            if x < 0:
                hist[n] += 1
                n = 0
    polys = sum(hist.values())
    tris_after = sum((k - 2) * v for k, v in hist.items())
    print("=== %s" % os.path.basename(path))
    print("    文件 %s bytes | FBX %s" % (format(len(b), ","), ver))
    print("    顶点 %s | 原生面 %s | 三角化后 %s"
          % (format(verts, ","), format(polys, ","), format(tris_after, ",")))
    for k in sorted(hist):
        label = {3: "三角形", 4: "四边形"}.get(k, "%d 边形" % k)
        print("      %-8s %8s  %6.2f%%" % (label, format(hist[k], ","),
                                           100.0 * hist[k] / polys))
    return dict(path=path, verts=verts, polys=polys, tris_after=tris_after,
                hist=dict(hist))


if __name__ == "__main__":
    for p in sys.argv[1:]:
        report(p)
        print()
