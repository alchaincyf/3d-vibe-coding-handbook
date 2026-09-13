#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Tripo P2.0 的 FBX → 巴黎 demo 能直接用的 GLB。

三件事：
  1. FBX → GLB（几何 / UV / 法线 / 材质），四边形由 glTF 导出器三角化
  2. 内嵌 8192×8192 base color 降采样到 1024×1024（--texture-size 可调）
  3. 原点、朝向、包围盒尺度一比一保持——world.mjs 按米数做实例缩放，
     尺度或朝向一变整座城的比例就散了

这一个文件同时是「宿主脚本」和「Blender 内部脚本」：
  宿主  python3 fbx2glb.py in.fbx -o out.glb
  内部  Blender 以 --python 再次执行本文件，靠 `import bpy` 能否成功分流

依赖：Blender（/Applications/Blender.app，可用 --blender 覆盖）、Pillow、numpy
"""

import sys, os, json, struct, zlib, shutil, subprocess, argparse, tempfile, math

# ----------------------------------------------------------------------------
# 判断自己跑在哪一侧
# ----------------------------------------------------------------------------
try:
    import bpy  # noqa
    IN_BLENDER = True
except ImportError:
    IN_BLENDER = False

DEFAULT_BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"


# ============================================================================
# 第一部分：无依赖 FBX 解析（只用来取「真值」，不参与转换）
# ============================================================================

class FbxNode:
    __slots__ = ('name', 'props', 'children')
    def __init__(self, n):
        self.name = n; self.props = []; self.children = []


def _fbx_read_props(b, off, n):
    props = []
    for _ in range(n):
        t = chr(b[off]); off += 1
        if t == 'Y':   props.append(struct.unpack_from('<h', b, off)[0]); off += 2
        elif t == 'C': props.append(bool(b[off])); off += 1
        elif t == 'I': props.append(struct.unpack_from('<i', b, off)[0]); off += 4
        elif t == 'F': props.append(struct.unpack_from('<f', b, off)[0]); off += 4
        elif t == 'D': props.append(struct.unpack_from('<d', b, off)[0]); off += 8
        elif t == 'L': props.append(struct.unpack_from('<q', b, off)[0]); off += 8
        elif t in 'fdlib':
            ln, enc, cl = struct.unpack_from('<III', b, off); off += 12
            raw = b[off:off + cl]; off += cl
            if enc == 1:
                raw = zlib.decompress(raw)
            props.append(('ARRAY', t, ln, raw, {'f': 'f', 'd': 'd', 'l': 'q', 'i': 'i', 'b': 'b'}[t]))
        elif t in 'SR':
            ln = struct.unpack_from('<I', b, off)[0]; off += 4
            data = b[off:off + ln]; off += ln
            props.append(data.decode('utf-8', 'replace') if t == 'S' else ('RAW', ln, data))
        else:
            raise ValueError('未知 FBX 属性类型 %r @%d' % (t, off))
    return props, off


def _fbx_parse(b, off, ver):
    big = ver >= 7500
    fmt = '<QQQB' if big else '<IIIB'
    sz = 25 if big else 13
    nodes = []
    while True:
        end, nprop, plen, nlen = struct.unpack_from(fmt, b, off)
        if end == 0 and nprop == 0 and plen == 0 and nlen == 0:
            off += sz; break
        p = off + sz
        name = b[p:p + nlen].decode('utf-8', 'replace'); p += nlen
        nd = FbxNode(name)
        nd.props, p = _fbx_read_props(b, p, nprop)
        if p < end:
            nd.children, p = _fbx_parse(b, p, ver)
        nodes.append(nd)
        off = end
        if off >= len(b) - sz:
            break
    return nodes, off


def _props70(node):
    out = {}
    for c in node.children:
        if c.name != 'Properties70':
            continue
        for p in c.children:
            if p.name == 'P' and p.props:
                out[p.props[0]] = p.props[4:] if len(p.props) > 4 else []
    return out


def _child_array(node, child_name):
    for c in node.children:
        if c.name == child_name:
            for p in c.props:
                if isinstance(p, tuple) and p[0] == 'ARRAY':
                    return p
    return None


def _img_dims(d):
    """从字节流读图片尺寸，不解码像素。"""
    if d[:8] == b'\x89PNG\r\n\x1a\n':
        w, h = struct.unpack_from('>II', d, 16); return ('png', w, h)
    if d[:2] == b'\xff\xd8':
        i = 2
        while i < len(d) - 1:
            if d[i] != 0xFF:
                i += 1; continue
            m = d[i + 1]
            if m in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                h, w = struct.unpack_from('>HH', d, i + 5); return ('jpeg', w, h)
            if m in (0xD8, 0xD9) or 0xD0 <= m <= 0xD7:
                i += 2; continue
            i += 2 + struct.unpack_from('>H', d, i + 2)[0]
        return ('jpeg', None, None)
    if d[:4] == b'RIFF' and d[8:12] == b'WEBP':
        return ('webp', None, None)
    return ('?', None, None)


def _rot_x(deg):
    r = math.radians(deg); c, s = math.cos(r), math.sin(r)
    return lambda p: (p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c)


def _rot_y(deg):
    r = math.radians(deg); c, s = math.cos(r), math.sin(r)
    return lambda p: (p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c)


def probe_fbx(path, yaw=0.0):
    """返回 P2.0 FBX 的真值字典。包围盒给的是 **glTF 约定（Y-up 右手）下的世界坐标**。
    yaw 是绕 glTF +Y 轴的偏航角（度），用来对齐旧资产的朝向；
    包围盒按真实顶点逐点旋转后再求，所以任意角度都精确。"""
    b = open(path, 'rb').read()
    if b[:21] != b'Kaydara FBX Binary  \x00':
        raise SystemExit('不是 FBX 二进制：%s' % path)
    ver = struct.unpack_from('<I', b, 23)[0]
    root, _ = _fbx_parse(b, 27, ver)
    top = {n.name: n for n in root}

    gs = _props70(top['GlobalSettings']) if 'GlobalSettings' in top else {}
    up_axis = gs.get('UpAxis', [None])[0]
    unit_scale = gs.get('UnitScaleFactor', [None])[0]

    geoms, models, videos = [], [], []
    for c in top.get('Objects', FbxNode('x')).children:
        if c.name == 'Geometry': geoms.append(c)
        elif c.name == 'Model': models.append(c)
        elif c.name == 'Video': videos.append(c)

    # 节点变换：只支持 Tripo 实际产出的形态（单 Model + Lcl Rotation 绕 X）
    xforms = []
    for m in models:
        mp = _props70(m)
        rot = mp.get('Lcl Rotation', [0.0, 0.0, 0.0])
        loc = mp.get('Lcl Translation', [0.0, 0.0, 0.0])
        scl = mp.get('Lcl Scaling', [1.0, 1.0, 1.0])
        xforms.append((loc, rot, scl))
        if abs(rot[1]) > 1e-6 or abs(rot[2]) > 1e-6:
            print('[warn] Model 节点带绕 Y/Z 的旋转 %s，本脚本的真值推导只处理绕 X，'
                  '包围盒核验结果请以 Blender 侧读数为准' % (rot,), file=sys.stderr)

    total_v = total_tri = total_poly = 0
    quads = tris_n = ngons = 0
    bmin = [float('inf')] * 3
    bmax = [float('-inf')] * 3
    uv_layers = []

    for g in geoms:
        va = _child_array(g, 'Vertices')
        pa = _child_array(g, 'PolygonVertexIndex')
        if va is None:
            continue
        elsz = 8 if va[4] == 'd' else 4
        v = struct.unpack('<%d%s' % (va[2], va[4]), va[3][:va[2] * elsz])
        total_v += va[2] // 3

        rx = _rot_x(xforms[0][1][0]) if xforms else (lambda p: p)
        ry = _rot_y(yaw) if yaw else (lambda p: p)
        for i in range(0, len(v), 3):
            # FBX 世界（Y-up）= Rx(Lcl Rotation.x) · 几何局部，再叠 --yaw
            p = ry(rx((v[i], v[i + 1], v[i + 2])))
            for k in range(3):
                if p[k] < bmin[k]: bmin[k] = p[k]
                if p[k] > bmax[k]: bmax[k] = p[k]

        if pa is not None:
            idx = struct.unpack('<%di' % pa[2], pa[3][:pa[2] * 4])
            cnt = 0
            for x in idx:
                cnt += 1
                if x < 0:
                    total_poly += 1
                    total_tri += cnt - 2
                    if cnt == 3: tris_n += 1
                    elif cnt == 4: quads += 1
                    else: ngons += 1
                    cnt = 0
        for ch in g.children:
            if ch.name == 'LayerElementUV':
                for cc in ch.children:
                    if cc.name == 'Name':
                        uv_layers.append(cc.props[0])

    images = []
    for vd in videos:
        nm = vd.props[1].split('\x00')[0] if len(vd.props) > 1 else '?'
        for ch in vd.children:
            if ch.name == 'Content':
                for p in ch.props:
                    if isinstance(p, tuple) and p[0] == 'RAW' and p[1] > 0:
                        fmt, w, h = _img_dims(p[2])
                        images.append({'name': nm, 'format': fmt, 'w': w, 'h': h,
                                       'bytes': p[1], 'data': p[2]})

    return {
        'path': path,
        'file_bytes': len(b),
        'fbx_version': ver,
        'up_axis': up_axis,
        'unit_scale': unit_scale,
        'meshes': len(geoms),
        'vertices': total_v,
        'polygons': total_poly,
        'quads': quads, 'tris': tris_n, 'ngons': ngons,
        'triangles': total_tri,
        'uv_layers': uv_layers,
        'images': images,
        'yaw': yaw,
        # glTF 也是 Y-up 右手，FBX 世界坐标可直接当目标
        'bbox_min': bmin, 'bbox_max': bmax,
        'dims': [bmax[i] - bmin[i] for i in range(3)],
    }


# ============================================================================
# 第二部分：无依赖 GLB 解析（核验产出）
# ============================================================================

def probe_glb(path):
    import numpy as np
    b = open(path, 'rb').read()
    if b[:4] != b'glTF':
        raise SystemExit('不是 GLB：%s' % path)
    off = 12
    js = None; binc = b''
    while off < len(b):
        clen, ctype = struct.unpack_from('<I4s', b, off); off += 8
        chunk = b[off:off + clen]; off += clen
        if ctype == b'JSON': js = json.loads(chunk.decode('utf-8'))
        elif ctype[:3] == b'BIN': binc = chunk
    g = js

    bufviews = g.get('bufferViews', [])
    def bv_bytes(i):
        bv = bufviews[i]
        s = bv.get('byteOffset', 0)
        return binc[s:s + bv['byteLength']]

    CT = {5120: 'i1', 5121: 'u1', 5122: 'i2', 5123: 'u2', 5125: 'u4', 5126: 'f4'}
    NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

    def read_accessor(ai):
        a = g['accessors'][ai]
        n = NC[a['type']]; dt = np.dtype('<' + CT[a['componentType']])
        if 'bufferView' not in a:
            return np.zeros((a['count'], n), dtype=dt)
        bv = bufviews[a['bufferView']]
        base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride') or n * dt.itemsize
        out = np.empty((a['count'], n), dtype=dt)
        for i in range(a['count']):
            out[i] = np.frombuffer(binc, dtype=dt, count=n, offset=base + i * stride)
        return out

    def node_matrix(nd):
        if 'matrix' in nd:
            return np.array(nd['matrix'], dtype='f8').reshape(4, 4).T
        M = np.eye(4)
        if 'scale' in nd:
            M = M @ np.diag(list(nd['scale']) + [1.0])
        if 'rotation' in nd:
            x, y, z, w = nd['rotation']
            R = np.array([
                [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0],
                [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0],
                [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0],
                [0, 0, 0, 1]], dtype='f8')
            M = R @ M
        if 'translation' in nd:
            T = np.eye(4); T[:3, 3] = nd['translation']
            M = T @ M
        return M

    nodes = g.get('nodes', [])
    meshes = g.get('meshes', [])
    bmin = np.array([np.inf] * 3); bmax = np.array([-np.inf] * 3)
    nvert = ntri = 0
    prim_modes = set(); attrs = set()

    def walk(ni, parent):
        nonlocal bmin, bmax, nvert, ntri
        nd = nodes[ni]
        M = parent @ node_matrix(nd)
        if 'mesh' in nd:
            for prim in meshes[nd['mesh']].get('primitives', []):
                prim_modes.add(prim.get('mode', 4))
                attrs.update(prim['attributes'].keys())
                pai = prim['attributes']['POSITION']
                pos = read_accessor(pai).astype('f8')
                # KHR_mesh_quantization：normalized 的整型要按分量类型归一化回 [-1,1] / [0,1]。
                # paris-demo 现有 26 件全是 normalized int16，不除这一下读出来的包围盒会差 32767 倍。
                pa = g['accessors'][pai]
                if pa.get('normalized'):
                    pos = pos / {5120: 127.0, 5121: 255.0,
                                 5122: 32767.0, 5123: 65535.0}[pa['componentType']]
                    if pa['componentType'] in (5120, 5122):
                        pos = np.maximum(pos, -1.0)
                nvert += pos.shape[0]
                if 'indices' in prim:
                    ntri += g['accessors'][prim['indices']]['count'] // 3
                else:
                    ntri += pos.shape[0] // 3
                h = np.hstack([pos, np.ones((pos.shape[0], 1))])
                w = (M @ h.T).T[:, :3]
                bmin = np.minimum(bmin, w.min(axis=0))
                bmax = np.maximum(bmax, w.max(axis=0))
        for c in nd.get('children', []):
            walk(c, M)

    scene = g.get('scenes', [{}])[g.get('scene', 0)]
    for ni in scene.get('nodes', []):
        walk(ni, np.eye(4))

    images = []
    for im in g.get('images', []):
        if 'bufferView' in im:
            d = bv_bytes(im['bufferView'])
            fmt, w, h = _img_dims(d)
            images.append({'name': im.get('name'), 'mimeType': im.get('mimeType'),
                           'format': fmt, 'w': w, 'h': h, 'bytes': len(d), 'data': d})
        else:
            images.append({'name': im.get('name'), 'uri': im.get('uri')})

    mats = []
    for m in g.get('materials', []):
        pbr = m.get('pbrMetallicRoughness', {})
        mats.append({'name': m.get('name'),
                     'baseColorTexture': 'baseColorTexture' in pbr,
                     'baseColorFactor': pbr.get('baseColorFactor'),
                     'metallicFactor': pbr.get('metallicFactor'),
                     'roughnessFactor': pbr.get('roughnessFactor'),
                     'doubleSided': m.get('doubleSided')})

    return {
        'path': path, 'file_bytes': len(b),
        'generator': g.get('asset', {}).get('generator'),
        'extensionsUsed': g.get('extensionsUsed'), 'extensionsRequired': g.get('extensionsRequired'),
        'nodes': len(nodes), 'meshes': len(meshes), 'materials': len(mats),
        'textures': len(g.get('textures', [])), 'images': images, 'material_info': mats,
        'skins': len(g.get('skins', [])), 'animations': len(g.get('animations', [])),
        'vertices': int(nvert), 'triangles': int(ntri),
        'prim_modes': sorted(prim_modes), 'attributes': sorted(attrs),
        'bbox_min': bmin.tolist(), 'bbox_max': bmax.tolist(),
        'dims': (bmax - bmin).tolist(),
        'json': g,
    }


# ============================================================================
# 第三部分：Blender 侧
# ============================================================================

def run_in_blender():
    import bpy
    argv = sys.argv[sys.argv.index('--') + 1:]
    cfg = json.loads(argv[0])

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=cfg['fbx'])

    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    if not meshes:
        raise SystemExit('[blender] FBX 里没有网格')

    # 偏航：绕 glTF 的 +Y 轴。导出器把 Blender (x,y,z) 映到 glTF (x,z,-y)，
    # 所以 glTF 的 +Y 就是 Blender 的 +Z，绕 Z 转同角同向。
    # 转完就 apply 进网格，导出的 node 保持单位矩阵，下游不用管节点变换。
    yaw = float(cfg.get('yaw') or 0.0)
    if yaw:
        import math as _m
        for ob in bpy.data.objects:
            if ob.parent is None:
                ob.rotation_mode = 'XYZ'
                ob.rotation_euler.z += _m.radians(yaw)
        bpy.ops.object.select_all(action='SELECT')
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
        print('### yaw_applied=%.4f' % yaw)

    # 背面剔除：Blender 的 FBX 导入器默认不开，导出就成了 doubleSided，
    # 而 paris-demo 现有 25 件全是单面（three 的 FrontSide）。片元开销翻倍，对不上。
    # use_backface_culling=True → glTF doubleSided=false
    for mat in bpy.data.materials:
        mat.use_backface_culling = not bool(cfg.get('double_sided'))
    print('### double_sided=%s' % bool(cfg.get('double_sided')))

    # 换贴图：给每张内嵌图新建一个 image datablock 指向降采样后的文件，
    # 按「原图名」一一对应地替换，不是把所有槽位都换成第一张
    # （P2.0 目前只有 base color，但同一条管线以后可能吃到带 normal / ORM 的 FBX）。
    # 不改像素、不 pack，让 glTF 导出器原样复制这份 JPEG 字节。
    tex_map = cfg.get('textures') or {}
    swapped, missed = 0, []
    if tex_map:
        loaded = {k: bpy.data.images.load(v, check_existing=False) for k, v in tex_map.items()}
        news = set(loaded.values())

        def pick(im):
            for key in (im.name, os.path.basename(im.filepath or '')):
                if key in loaded:
                    return loaded[key]
            # 退而求其次：只有一张图时按位置对应
            return loaded[next(iter(loaded))] if len(loaded) == 1 else None

        for mat in bpy.data.materials:
            if not mat.use_nodes:
                continue
            for node in mat.node_tree.nodes:
                if node.type != 'TEX_IMAGE' or node.image is None or node.image in news:
                    continue
                tgt = pick(node.image)
                if tgt is None:
                    missed.append(node.image.name); continue
                node.image = tgt
                swapped += 1
        for im in list(bpy.data.images):
            if im not in news and im.users == 0:
                try: bpy.data.images.remove(im)
                except Exception: pass
        print('### texture_swapped=%d missed=%s -> %s'
              % (swapped, missed or 'none',
                 {os.path.basename(v): tuple(loaded[k].size) for k, v in tex_map.items()}))
        if missed:
            raise SystemExit('[blender] 有贴图槽位没能对上降采样图：%s' % missed)

    # 导出前量一次世界包围盒（Blender 是 Z-up）
    for ob in meshes:
        ob.data.calc_loop_triangles()
    bb = [[float('inf')] * 3, [float('-inf')] * 3]
    vtot = ptot = ttot = 0
    for ob in meshes:
        mw = ob.matrix_world
        me = ob.data
        vtot += len(me.vertices); ptot += len(me.polygons)
        ttot += sum(len(p.vertices) - 2 for p in me.polygons)
        for v in me.vertices:
            c = mw @ v.co
            for k in range(3):
                bb[0][k] = min(bb[0][k], c[k]); bb[1][k] = max(bb[1][k], c[k])
    print('### blender_stats=%s' % json.dumps({
        'vertices': vtot, 'polygons': ptot, 'triangles': ttot,
        'bbox_min_zup': bb[0], 'bbox_max_zup': bb[1],
        # Blender Z-up → glTF Y-up：(x, y, z) → (x, z, -y)
        'bbox_min_yup': [bb[0][0], bb[0][2], -bb[1][1]],
        'bbox_max_yup': [bb[1][0], bb[1][2], -bb[0][1]],
    }))

    kw = dict(
        filepath=cfg['out'],
        export_format='GLB',
        export_yup=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials='EXPORT',
        export_image_format='AUTO',        # JPEG 源保持 JPEG，字节原样搬运
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        use_selection=False,
        export_hierarchy_flatten_objs=False,
    )
    if cfg.get('jpeg_quality'):
        try:
            kw['export_jpeg_quality'] = int(cfg['jpeg_quality'])
        except Exception:
            pass
    bpy.ops.export_scene.gltf(**kw)
    print('### exported=%s' % cfg['out'])


# ============================================================================
# 第四部分：宿主侧
# ============================================================================

def fmt_bbox(mn, mx):
    return ('X[%+.6f,%+.6f] Y[%+.6f,%+.6f] Z[%+.6f,%+.6f]'
            % (mn[0], mx[0], mn[1], mx[1], mn[2], mx[2]))


def main_host():
    ap = argparse.ArgumentParser(description='Tripo P2.0 FBX → 巴黎 demo 用 GLB')
    ap.add_argument('fbx', help='输入 FBX')
    ap.add_argument('-o', '--out', help='输出 GLB（默认与输入同名换后缀，落在 --outdir）')
    ap.add_argument('--outdir', default=None, help='输出目录（默认 <脚本目录>/out）')
    ap.add_argument('--texture-size', type=int, default=1024, help='贴图边长，默认 1024；0 = 不降采样')
    ap.add_argument('--jpeg-quality', type=int, default=92, help='降采样后 JPEG 质量，默认 92')
    ap.add_argument('--blender', default=os.environ.get('BLENDER', DEFAULT_BLENDER))
    ap.add_argument('--keep-work', action='store_true', help='保留中间目录')
    ap.add_argument('--bbox-tol', type=float, default=1e-5, help='包围盒容差（单位：模型单位）')
    ap.add_argument('--dump-texture', action='store_true', help='另存一份降采样贴图 PNG 供肉眼检查')
    ap.add_argument('--yaw', type=float, default=0.0,
                    help='绕 glTF +Y 轴的偏航角（度），用来把 P2.0 的默认朝向转到旧资产的朝向。'
                         '默认 0 = 原样不动')
    ap.add_argument('--double-sided', action='store_true',
                    help='材质导出成 doubleSided。默认关（对齐 paris-demo 现有 25 件的单面材质）')
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    fbx = os.path.abspath(args.fbx)
    if not os.path.exists(fbx):
        raise SystemExit('找不到输入：%s' % fbx)
    outdir = os.path.abspath(args.outdir) if args.outdir else os.path.join(here, 'out')
    os.makedirs(outdir, exist_ok=True)
    out = os.path.abspath(args.out) if args.out else os.path.join(
        outdir, os.path.splitext(os.path.basename(fbx))[0] + '.glb')

    if not os.path.exists(args.blender):
        raise SystemExit('找不到 Blender：%s（用 --blender 指定，或设环境变量 BLENDER）' % args.blender)

    print('=' * 74)
    print('输入  %s' % fbx)
    print('输出  %s' % out)
    print('=' * 74)

    # --- 1. 读源真值 -------------------------------------------------------
    src = probe_fbx(fbx, yaw=args.yaw)
    print('\n[源 FBX]')
    print('  FBX %d  UpAxis=%s  UnitScaleFactor=%s  %s 字节'
          % (src['fbx_version'], src['up_axis'], src['unit_scale'], f"{src['file_bytes']:,}"))
    print('  网格 %d  顶点 %s  多边形 %s（四边形 %s / 三角 %s / N边形 %s）  三角化后 %s'
          % (src['meshes'], f"{src['vertices']:,}", f"{src['polygons']:,}",
             f"{src['quads']:,}", f"{src['tris']:,}", f"{src['ngons']:,}", f"{src['triangles']:,}"))
    print('  UV 层  %s' % src['uv_layers'])
    for im in src['images']:
        print('  内嵌贴图  %s  %s %sx%s  %s 字节'
              % (im['name'], im['format'], im['w'], im['h'], f"{im['bytes']:,}"))
    if args.yaw:
        print('  偏航 --yaw %+.2f°（绕 glTF +Y），包围盒真值已按逐顶点旋转重算' % args.yaw)
    print('  目标包围盒（Y-up）  %s' % fmt_bbox(src['bbox_min'], src['bbox_max']))
    print('  目标尺寸            %.6f x %.6f x %.6f' % tuple(src['dims']))

    work = tempfile.mkdtemp(prefix='fbx2glb_')
    try:
        # --- 2. 降采样贴图 -------------------------------------------------
        tex_map = {}
        if args.texture_size and src['images']:
            from PIL import Image
            import io
            n = args.texture_size
            print('\n[贴图]')
            for i, im0 in enumerate(src['images']):
                raw = Image.open(io.BytesIO(im0['data']))
                is_png = (im0['format'] == 'png')
                raw = raw.convert('RGBA' if (is_png and raw.mode in ('RGBA', 'LA', 'P')) else 'RGB')
                if raw.mode == 'P':
                    raw = raw.convert('RGB')
                small = raw.resize((n, n), Image.LANCZOS)
                stem = os.path.splitext(os.path.basename(im0['name']))[0] or ('tex%d' % i)
                if is_png:
                    tp = os.path.join(work, '%s_%d.png' % (stem, n))
                    small.save(tp, 'PNG', optimize=True)
                else:
                    tp = os.path.join(work, '%s_%d.jpg' % (stem, n))
                    small.convert('RGB').save(tp, 'JPEG', quality=args.jpeg_quality,
                                              subsampling=0, optimize=True)
                tex_map[im0['name']] = tp
                print('  %-52s %sx%s → %dx%d   %s → %s 字节'
                      % (im0['name'][:52], im0['w'], im0['h'], n, n,
                         f"{im0['bytes']:,}", f"{os.path.getsize(tp):,}"))
                if args.dump_texture:
                    sfx = '_basecolor' if len(src['images']) == 1 else '_tex%d' % i
                    png = os.path.join(outdir, os.path.splitext(os.path.basename(out))[0] + sfx + '.png')
                    small.save(png, 'PNG')
                    print('  %-52s 肉眼检查图 %s' % ('', png))
        elif src['images']:
            print('\n[贴图]  --texture-size 0，保持 %sx%s 原样' % (src['images'][0]['w'], src['images'][0]['h']))

        # --- 3. 跑 Blender -------------------------------------------------
        # FBX 里的内嵌贴图会被 Blender 解包到 <fbx名>.fbm/ 旁边，所以先复制进临时目录
        fbx_copy = os.path.join(work, os.path.basename(fbx))
        shutil.copy2(fbx, fbx_copy)
        cfg = {'fbx': fbx_copy, 'out': out, 'textures': tex_map,
               'jpeg_quality': args.jpeg_quality, 'yaw': args.yaw,
               'double_sided': args.double_sided}
        cmd = [args.blender, '--background', '--factory-startup',
               '--python', os.path.abspath(__file__), '--', json.dumps(cfg)]
        print('\n[Blender] %s' % args.blender)
        r = subprocess.run(cmd, capture_output=True, text=True)
        blender_stats = None
        for line in r.stdout.splitlines():
            if line.startswith('### '):
                print('  ' + line[4:])
                if line.startswith('### blender_stats='):
                    blender_stats = json.loads(line[len('### blender_stats='):])
        if r.returncode != 0 or not os.path.exists(out):
            sys.stderr.write(r.stdout[-4000:] + '\n' + r.stderr[-4000:] + '\n')
            raise SystemExit('[fail] Blender 转换失败（returncode=%d）' % r.returncode)

        # --- 4. 核验产出 ---------------------------------------------------
        ok = verify(src, out, tol=args.bbox_tol,
                    want_tex=args.texture_size or None, blender_stats=blender_stats,
                    want_double_sided=args.double_sided)
        print('\n' + ('=' * 74))
        print('结果  %s  %s 字节' % (out, f"{os.path.getsize(out):,}"))
        print('核验  %s' % ('全部通过' if ok else '**有项目未通过，见上**'))
        print('=' * 74)
        return 0 if ok else 2
    finally:
        if args.keep_work:
            print('[work] %s' % work)
        else:
            shutil.rmtree(work, ignore_errors=True)


def verify(src, glb_path, tol=1e-5, want_tex=None, blender_stats=None, want_double_sided=False):
    dst = probe_glb(glb_path)
    print('\n[核验]')
    checks = []

    def chk(name, ok, detail):
        checks.append(ok)
        print('  %s %-28s %s' % ('✅' if ok else '❌', name, detail))

    chk('GLB 头与 chunk 可解',
        dst['generator'] is not None,
        'generator=%s  ext=%s' % (dst['generator'], dst['extensionsRequired']))
    chk('无需扩展即可读',
        not dst['extensionsRequired'],
        'extensionsRequired=%s' % (dst['extensionsRequired'] or '无'))
    chk('顶点数与源一致',
        dst['vertices'] == src['vertices'] or dst['vertices'] >= src['vertices'],
        '源 %s → GLB %s%s' % (f"{src['vertices']:,}", f"{dst['vertices']:,}",
                              '（UV/法线接缝会拆点，只增不减）' if dst['vertices'] != src['vertices'] else ''))
    chk('三角面数与源一致',
        dst['triangles'] == src['triangles'],
        '源三角化后 %s → GLB %s' % (f"{src['triangles']:,}", f"{dst['triangles']:,}"))
    chk('图元是三角形',
        dst['prim_modes'] == [4],
        'mode=%s' % dst['prim_modes'])
    chk('带 UV 与法线',
        'TEXCOORD_0' in dst['attributes'] and 'NORMAL' in dst['attributes'],
        '%s' % dst['attributes'])

    d = max(abs(dst['bbox_min'][i] - src['bbox_min'][i]) for i in range(3))
    d = max(d, max(abs(dst['bbox_max'][i] - src['bbox_max'][i]) for i in range(3)))
    chk('包围盒与源一致', d <= tol, '最大偏差 %.3e（容差 %.0e）' % (d, tol))
    print('       源 %s' % fmt_bbox(src['bbox_min'], src['bbox_max']))
    print('      GLB %s' % fmt_bbox(dst['bbox_min'], dst['bbox_max']))
    print('      尺寸 源 %.6f x %.6f x %.6f  →  GLB %.6f x %.6f x %.6f'
          % (tuple(src['dims']) + tuple(dst['dims'])))

    if blender_stats:
        bd = max(abs(blender_stats['bbox_min_yup'][i] - dst['bbox_min'][i]) for i in range(3))
        bd = max(bd, max(abs(blender_stats['bbox_max_yup'][i] - dst['bbox_max'][i]) for i in range(3)))
        chk('Blender 侧读数对得上', bd <= 1e-4, '最大偏差 %.3e' % bd)

    if want_tex:
        im = dst['images'][0] if dst['images'] else None
        chk('贴图尺寸 = %d²' % want_tex,
            bool(im) and im['w'] == want_tex and im['h'] == want_tex,
            '%s %sx%s  %s 字节' % (im['format'], im['w'], im['h'], f"{im['bytes']:,}") if im else '没有贴图')
    chk('单/双面与预期一致',
        bool(dst['material_info'])
        and bool(dst['material_info'][0]['doubleSided']) == bool(want_double_sided),
        'doubleSided=%s（预期 %s；paris-demo 现有 25 件都是单面）'
        % (bool(dst['material_info'][0]['doubleSided']) if dst['material_info'] else '?',
           bool(want_double_sided)))
    chk('材质带 baseColorTexture',
        bool(dst['material_info']) and dst['material_info'][0]['baseColorTexture'],
        '%s' % (dst['material_info'][0] if dst['material_info'] else '无材质'))

    return all(checks)


if __name__ == '__main__':
    if IN_BLENDER:
        run_in_blender()
    else:
        sys.exit(main_host())
