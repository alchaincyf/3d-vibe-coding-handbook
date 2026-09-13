#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GLB → GLB：内嵌贴图降采样（+ 可选偏航 / 等比缩放），给已经是 GLB 的 P2.0 资产用。

和 fbx2glb.py 的分工：
  fbx2glb.py   FBX → GLB，过 Blender
  本脚本       GLB → GLB，**不过 Blender**，直接改 glTF JSON + BIN chunk

不过 Blender 是刻意的：Blender 一个来回会重排顶点、重算法线、把材质重新映射一遍，
还会默认把 doubleSided 打开（转换管线.md 坑 #2）。本脚本只动两样东西——
images 的字节，以及（可选）场景根节点的变换矩阵——其余字节原样搬过去。
所以「三角面不变 / 包围盒不变 / extensionsRequired 不变 / doubleSided 不变」
不是靠事后核验捞回来的，是构造上就动不了。

贴图替换沿用 fbx2glb.py 的语义：**按原图名一一对应，对不上直接报错退出**
（转换管线.md 坑 #3：不能「把所有槽位都换成第一张图」）。

用法：
  python3 glb_downscale.py in.glb -o out.glb                    # 只降贴图到 1024
  python3 glb_downscale.py in.glb -o out.glb --yaw -90          # 再绕 +Y 转 -90°
  python3 glb_downscale.py in.glb -o out.glb --yaw -90 --match-height 旧.glb
"""

import sys, os, json, struct, argparse, math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fbx2glb import probe_glb, fmt_bbox   # 复用无依赖 GLB 解析器（真值/核验两用）

import numpy as np


# ----------------------------------------------------------------------------
def load_glb(path):
    b = open(path, 'rb').read()
    if b[:4] != b'glTF':
        raise SystemExit('不是 GLB：%s' % path)
    ver, total = struct.unpack_from('<II', b, 4)
    off = 12
    js, binc = None, b''
    while off < len(b):
        clen, ctype = struct.unpack_from('<I4s', b, off); off += 8
        chunk = b[off:off + clen]; off += clen
        if ctype == b'JSON':
            js = json.loads(chunk.decode('utf-8'))
        elif ctype[:3] == b'BIN':
            binc = chunk
    if js is None:
        raise SystemExit('GLB 没有 JSON chunk：%s' % path)
    return js, binc


def write_glb(path, js, binc):
    jb = json.dumps(js, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    bb = binc + b'\x00' * ((4 - len(binc) % 4) % 4)
    total = 12 + 8 + len(jb) + (8 + len(bb) if bb else 0)
    with open(path, 'wb') as f:
        f.write(b'glTF' + struct.pack('<II', 2, total))
        f.write(struct.pack('<I', len(jb)) + b'JSON' + jb)
        if bb:
            f.write(struct.pack('<I', len(bb)) + b'BIN\x00' + bb)
    return total


def img_dims(d):
    """只读图片头，判格式和边长。JPEG / PNG 两种足够。"""
    if d[:2] == b'\xff\xd8':
        i = 2
        while i < len(d):
            if d[i] != 0xFF:
                i += 1; continue
            m = d[i + 1]; i += 2
            if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7:
                continue
            ln = struct.unpack_from('>H', d, i)[0]
            if m in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                     0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                h, w = struct.unpack_from('>HH', d, i + 3)
                return 'jpeg', w, h
            i += ln
        return 'jpeg', None, None
    if d[:8] == b'\x89PNG\r\n\x1a\n':
        w, h = struct.unpack_from('>II', d, 16)
        return 'png', w, h
    return '?', None, None


def rot_y(deg):
    r = math.radians(deg); c, s = math.cos(r), math.sin(r)
    return np.array([[c, 0, s, 0], [0, 1, 0, 0], [-s, 0, c, 0], [0, 0, 0, 1]], dtype='f8')


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


# ----------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description='P2.0 GLB 贴图降采样（+可选偏航/等比缩放）')
    ap.add_argument('glb', help='输入 GLB')
    ap.add_argument('-o', '--out', required=True, help='输出 GLB')
    ap.add_argument('--texture-size', type=int, default=1024, help='贴图边长，默认 1024；0=不降')
    ap.add_argument('--jpeg-quality', type=int, default=92)
    ap.add_argument('--yaw', type=float, default=0.0, help='绕 glTF +Y 的偏航角（度）')
    ap.add_argument('--scale', type=float, default=1.0, help='等比缩放系数')
    ap.add_argument('--match-height', default=None,
                    help='给一个旧 GLB，自动按「旧件高度 / 新件高度」算等比缩放系数')
    ap.add_argument('--keep-double-sided', action='store_true',
                    help='保留源 GLB 的 doubleSided。默认强制单面——assets-3 那 38 件是用旧的 '
                         '_fbx2glb.py 出的，没设 use_backface_culling，全都是 doubleSided=true，'
                         '正是转换管线.md 坑 #2；片元开销翻倍，且和 paris-demo 现有 26 件不一致')
    ap.add_argument('--bake', action='store_true',
                    help='把 yaw/scale 烘进顶点数据，而不是写进根节点矩阵。'
                         'world.mjs 的 loadCityTree() 用 Box3.setFromObject 量世界包围盒，'
                         '却把归一化施加在**原始 geometry** 上（无视节点矩阵），'
                         '所以给树写节点矩阵会静默错位。烘顶点对两条路都安全')
    ap.add_argument('--emulate-node-scale', type=float, default=None,
                    help='配合 --bake：把总变换拆成「根节点均匀缩放 S」+「烘进顶点的剩余部分」，'
                         '世界包围盒不变。用来复刻旧 tree-01 的节点缩放——'
                         'loadCityTree 的归一化结果取决于 local/world 的比值，这个比值必须和旧件一样')
    ap.add_argument('--dump-texture', action='store_true')
    ap.add_argument('--json', default=None, help='把核验结果写成 JSON')
    args = ap.parse_args()

    src_path = os.path.abspath(args.glb)
    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)

    src = probe_glb(src_path)          # 真值：三角面 / 包围盒 / 扩展 / doubleSided
    js, binc = load_glb(src_path)

    print('=' * 74)
    print('输入  %s  %s 字节' % (src_path, f"{src['file_bytes']:,}"))
    print('  三角 %s  顶点 %s  网格 %d  材质 %d  贴图槽 %d  skins %d  anim %d'
          % (f"{src['triangles']:,}", f"{src['vertices']:,}", src['meshes'],
             src['materials'], src['textures'], src['skins'], src['animations']))
    print('  extensionsRequired=%s  doubleSided=%s'
          % (src['extensionsRequired'] or '无',
             [m['doubleSided'] for m in src['material_info']]))
    print('  包围盒 %s' % fmt_bbox(src['bbox_min'], src['bbox_max']))
    print('  尺寸   %.6f x %.6f x %.6f' % tuple(src['dims']))

    # --- 1. 等比缩放系数 ----------------------------------------------------
    scale = args.scale
    ref = None
    if args.match_height:
        ref = probe_glb(os.path.abspath(args.match_height))
        scale = ref['dims'][1] / src['dims'][1]
        print('\n[对齐旧件] %s' % os.path.basename(args.match_height))
        print('  旧件尺寸 %.6f x %.6f x %.6f' % tuple(ref['dims']))
        print('  等比系数 = 旧高 %.6f / 新高 %.6f = %.6f' % (ref['dims'][1], src['dims'][1], scale))

    # --- 2. 贴图降采样（按原图名一一对应，对不上报错退出）------------------
    tex_new = {}
    if args.texture_size and js.get('images'):
        from PIL import Image
        import io
        n = args.texture_size
        names = [im.get('name') or '' for im in js['images']]
        if len(set(names)) != len(names):
            raise SystemExit('[fail] 贴图名不唯一，无法一一对应：%s' % names)
        print('\n[贴图]')
        for i, im in enumerate(js['images']):
            if 'bufferView' not in im:
                raise SystemExit('[fail] images[%d] 不是内嵌（有 uri），本脚本只处理内嵌贴图' % i)
            bv = js['bufferViews'][im['bufferView']]
            s = bv.get('byteOffset', 0)
            data = binc[s:s + bv['byteLength']]
            fmt, w, h = img_dims(data)
            if w is None:
                raise SystemExit('[fail] images[%d] (%s) 读不出尺寸，格式=%s' % (i, names[i], fmt))
            if w <= n and h <= n:
                print('  %-46s %sx%s ≤ %d²，跳过' % ((names[i] or '(无名)')[:46], w, h, n))
                continue
            raw = Image.open(io.BytesIO(data))
            is_png = (fmt == 'png')
            raw = raw.convert('RGBA' if (is_png and raw.mode in ('RGBA', 'LA', 'P')) else 'RGB')
            small = raw.resize((n, n), Image.LANCZOS)
            buf = io.BytesIO()
            if is_png:
                small.save(buf, 'PNG', optimize=True)
                mime = 'image/png'
            else:
                small.convert('RGB').save(buf, 'JPEG', quality=args.jpeg_quality,
                                          subsampling=0, optimize=True)
                mime = 'image/jpeg'
            tex_new[i] = (buf.getvalue(), mime)
            print('  %-46s %sx%s → %dx%d   %s → %s 字节'
                  % ((names[i] or '(无名)')[:46], w, h, n, n,
                     f"{len(data):,}", f"{len(buf.getvalue()):,}"))
            if args.dump_texture:
                png = os.path.splitext(out)[0] + ('_basecolor.png' if len(js['images']) == 1
                                                  else '_tex%d.png' % i)
                small.save(png, 'PNG')
                print('  %-46s 肉眼检查图 %s' % ('', png))
        missed = [names[i] for i in range(len(js['images']))
                  if i not in tex_new and img_dims(
                      binc[js['bufferViews'][js['images'][i]['bufferView']].get('byteOffset', 0):
                           js['bufferViews'][js['images'][i]['bufferView']].get('byteOffset', 0)
                           + js['bufferViews'][js['images'][i]['bufferView']]['byteLength']])[1] > n]
        if missed:
            raise SystemExit('[fail] 有贴图没被替换：%s' % missed)

    # --- 2b. 强制单面 -------------------------------------------------------
    if not args.keep_double_sided:
        flipped = 0
        for m in js.get('materials', []):
            if m.get('doubleSided'):
                m['doubleSided'] = False
                flipped += 1
            else:
                m['doubleSided'] = False
        if flipped:
            print('\n[单面] %d 个材质 doubleSided true → false' % flipped)

    # --- 2c. 烘变换进顶点（--bake）-----------------------------------------
    bake_patch = {}           # bufferView 索引 → 新字节
    node_scale_after = None
    if args.bake and (abs(args.yaw) > 1e-9 or abs(scale - 1.0) > 1e-12
                      or args.emulate_node_scale):
        S = args.emulate_node_scale or 1.0
        node_scale_after = S if args.emulate_node_scale else None
        Mb = rot_y(args.yaw) @ np.diag([scale / S, scale / S, scale / S, 1.0])
        R = Mb[:3, :3]
        Rn = rot_y(args.yaw)[:3, :3]        # 法线只转不缩（等比缩放不改法线方向）
        scene = js['scenes'][js.get('scene', 0)]
        touched = set()

        def walk(ni):
            nd = js['nodes'][ni]
            if any(k in nd for k in ('matrix', 'rotation', 'translation', 'scale')):
                raise SystemExit('[fail] --bake 只支持根节点无自带变换的 GLB，node %d 有变换' % ni)
            if 'mesh' in nd:
                for prim in js['meshes'][nd['mesh']]['primitives']:
                    for attr, M in (('POSITION', R), ('NORMAL', Rn)):
                        ai = prim['attributes'].get(attr)
                        if ai is None or ai in touched:
                            continue
                        touched.add(ai)
                        a = js['accessors'][ai]
                        if a['componentType'] != 5126 or a['type'] != 'VEC3':
                            raise SystemExit('[fail] %s 不是 float32 VEC3，不烘' % attr)
                        bv = js['bufferViews'][a['bufferView']]
                        if bv.get('byteStride') not in (None, 12):
                            raise SystemExit('[fail] %s 是交错存储（byteStride=%s），不烘'
                                             % (attr, bv.get('byteStride')))
                        base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
                        raw = np.frombuffer(binc, dtype='<f4', count=a['count'] * 3,
                                            offset=base).reshape(-1, 3).astype('f8')
                        new = (M @ raw.T).T
                        if attr == 'NORMAL':
                            n = np.linalg.norm(new, axis=1, keepdims=True)
                            new = new / np.where(n == 0, 1, n)
                        buf = bytearray(bake_patch.get(a['bufferView'],
                                                       binc[bv.get('byteOffset', 0):
                                                            bv.get('byteOffset', 0) + bv['byteLength']]))
                        off_in = a.get('byteOffset', 0)
                        buf[off_in:off_in + a['count'] * 12] = new.astype('<f4').tobytes()
                        bake_patch[a['bufferView']] = bytes(buf)
                        if attr == 'POSITION' and 'min' in a:
                            corners = np.array([[a['min'][0] if (c >> 0) & 1 else a['max'][0],
                                                 a['min'][1] if (c >> 1) & 1 else a['max'][1],
                                                 a['min'][2] if (c >> 2) & 1 else a['max'][2]]
                                                for c in range(8)], dtype='f8')
                            w = (M @ corners.T).T
                            a['min'] = [float(v) for v in w.min(axis=0)]
                            a['max'] = [float(v) for v in w.max(axis=0)]
            for c in nd.get('children', []):
                walk(c)

        for ni in scene['nodes']:
            walk(ni)
        print('\n[烘变换] yaw=%+.2f°  scale=%.6f  已烘进 %d 个 accessor 的顶点数据%s'
              % (args.yaw, scale, len(touched),
                 '；根节点另留均匀缩放 %.9f' % S if args.emulate_node_scale else '；根节点保持恒等'))

    # --- 3. 重建 BIN chunk --------------------------------------------------
    newbin = bytearray()
    for bvi, bv in enumerate(js.get('bufferViews', [])):
        s = bv.get('byteOffset', 0)
        data = bake_patch.get(bvi, bytes(binc[s:s + bv['byteLength']]))
        for ii, (nd, mime) in tex_new.items():
            if js['images'][ii]['bufferView'] == bvi:
                data = nd
                js['images'][ii]['mimeType'] = mime
                break
        while len(newbin) % 4:
            newbin.append(0)
        bv['byteOffset'] = len(newbin)
        bv['byteLength'] = len(data)
        newbin += data
    js['buffers'] = [{'byteLength': len(newbin)}]

    # --- 4. 偏航 + 等比缩放：写进场景根节点的矩阵 --------------------------
    if args.bake:
        if node_scale_after:
            for ni in js['scenes'][js.get('scene', 0)]['nodes']:
                js['nodes'][ni]['scale'] = [node_scale_after] * 3
    elif abs(args.yaw) > 1e-9 or abs(scale - 1.0) > 1e-12:
        M0 = rot_y(args.yaw) @ np.diag([scale, scale, scale, 1.0])
        scene = js['scenes'][js.get('scene', 0)]
        for ni in scene['nodes']:
            nd = js['nodes'][ni]
            M = M0 @ node_matrix(nd)
            for k in ('matrix', 'translation', 'rotation', 'scale'):
                nd.pop(k, None)
            nd['matrix'] = [float(v) for v in M.T.reshape(-1)]
        print('\n[变换] yaw=%+.2f°  scale=%.6f  已写进 %d 个场景根节点的 matrix'
              % (args.yaw, scale, len(scene['nodes'])))

    write_glb(out, js, bytes(newbin))

    # --- 5. 核验 ------------------------------------------------------------
    dst = probe_glb(out)
    # 期望包围盒 = 源包围盒八个角经 R_y(yaw)·S 之后重新取轴对齐
    M0 = rot_y(args.yaw) @ np.diag([scale, scale, scale, 1.0])
    mn, mx = np.array(src['bbox_min']), np.array(src['bbox_max'])
    corners = np.array([[mn[0] if (c >> 0) & 1 else mx[0],
                         mn[1] if (c >> 1) & 1 else mx[1],
                         mn[2] if (c >> 2) & 1 else mx[2], 1.0] for c in range(8)])
    w = (M0 @ corners.T).T[:, :3]
    exp_min, exp_max = w.min(axis=0), w.max(axis=0)

    checks = []
    def chk(name, ok, detail):
        checks.append(ok)
        print('  %s %-26s %s' % ('✅' if ok else '❌', name, detail))

    print('\n[核验]')
    chk('三角面不变', dst['triangles'] == src['triangles'],
        '%s → %s' % (f"{src['triangles']:,}", f"{dst['triangles']:,}"))
    chk('顶点数不变', dst['vertices'] == src['vertices'],
        '%s → %s' % (f"{src['vertices']:,}", f"{dst['vertices']:,}"))
    chk('图元仍是三角形', dst['prim_modes'] == [4], 'mode=%s' % dst['prim_modes'])
    chk('带 UV 与法线',
        'TEXCOORD_0' in dst['attributes'] and 'NORMAL' in dst['attributes'],
        str(dst['attributes']))
    chk('extensionsRequired 为空', not dst['extensionsRequired'],
        str(dst['extensionsRequired'] or '无'))
    d = max(float(np.max(np.abs(np.array(dst['bbox_min']) - exp_min))),
            float(np.max(np.abs(np.array(dst['bbox_max']) - exp_max))))
    tol = 1e-5 * max(1.0, scale)
    chk('包围盒符合预期', d <= tol, '最大偏差 %.3e（容差 %.0e）' % (d, tol))
    print('       期望 %s' % fmt_bbox(exp_min, exp_max))
    print('       实得 %s' % fmt_bbox(dst['bbox_min'], dst['bbox_max']))
    print('       尺寸 %.6f x %.6f x %.6f' % tuple(dst['dims']))
    ds = [bool(m['doubleSided']) for m in dst['material_info']]
    chk('doubleSided 全 false', not any(ds), str(ds))
    chk('skins/anim 不变',
        dst['skins'] == src['skins'] and dst['animations'] == src['animations'],
        'skins %d anim %d' % (dst['skins'], dst['animations']))
    if args.texture_size:
        sizes = [(im.get('w'), im.get('h')) for im in dst['images']]
        chk('贴图 = %d²' % args.texture_size,
            all(a == args.texture_size and b == args.texture_size for a, b in sizes),
            str(sizes))
    if ref is not None:
        hd = abs(dst['dims'][1] - ref['dims'][1])
        chk('高度与旧件一致', hd <= 1e-4,
            '新 %.6f vs 旧 %.6f（差 %.2e）' % (dst['dims'][1], ref['dims'][1], hd))
        ar_new = [dst['dims'][0] / dst['dims'][1], dst['dims'][2] / dst['dims'][1]]
        ar_old = [ref['dims'][0] / ref['dims'][1], ref['dims'][2] / ref['dims'][1]]
        print('       长宽高比 新 X/Y=%.4f Z/Y=%.4f  |  旧 X/Y=%.4f Z/Y=%.4f'
              % (ar_new[0], ar_new[1], ar_old[0], ar_old[1]))

    okall = all(checks)
    print('\n结果  %s  %s 字节（源 %s，%.1f%%）'
          % (out, f"{os.path.getsize(out):,}", f"{src['file_bytes']:,}",
             100.0 * os.path.getsize(out) / src['file_bytes']))
    print('核验  %s' % ('全部通过' if okall else '**有项未通过**'))
    print('=' * 74)

    if args.json:
        rec = {'src': src_path, 'out': out, 'ok': okall,
               'yaw': args.yaw, 'scale': scale,
               'src_bytes': src['file_bytes'], 'out_bytes': os.path.getsize(out),
               'triangles': dst['triangles'], 'vertices': dst['vertices'],
               'dims_src': src['dims'], 'dims_out': dst['dims'],
               'images': [(im.get('w'), im.get('h'), im.get('bytes')) for im in dst['images']],
               'doubleSided': ds, 'extensionsRequired': dst['extensionsRequired'],
               'skins': dst['skins'], 'animations': dst['animations']}
        with open(args.json, 'w') as f:
            json.dump(rec, f, ensure_ascii=False, indent=1)
    return 0 if okall else 2


if __name__ == '__main__':
    sys.exit(main())
