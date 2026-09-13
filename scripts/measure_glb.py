#!/usr/bin/env python3
"""量一个 GLB 的真实包围盒——直接从文件算，不经过任何引擎。

为什么需要它：骨骼网格的包围盒在 three.js 里有三种量法
（Box3.setFromObject / SkinnedMesh.computeBoundingBox+matrixWorld / 逐顶点 applyBoneTransform），
**三种给出三个不同的数**，谁都不能当基准。于是 normalize() 算错缩放（人变大几倍）
和落点（浮空或陷地）。

这个脚本走的是 glTF 规范本身：
  1. 读 skins 的 joints + inverseBindMatrices
  2. 按节点层级算出每根骨在静止姿态下的世界矩阵
  3. 蒙皮矩阵 = 骨骼世界矩阵 × inverseBindMatrix
  4. 逐顶点套蒙皮矩阵，求真实包围盒
另外把 POSITION accessor 自带的 min/max 也打出来做交叉验证
（静止姿态下蒙皮矩阵应当近似单位阵，两者应当接近）。

用法：python3 measure_glb.py 产出/prince-walk.glb
"""
import json, struct, sys, math

def load_glb(path):
    d = open(path, 'rb').read()
    magic, ver, _ = struct.unpack('<III', d[:12])
    assert d[:4] == b'glTF', '不是 GLB'
    off, js, bin_ = 12, None, None
    while off < len(d):
        clen, ctype = struct.unpack('<II', d[off:off+8])
        chunk = d[off+8:off+8+clen]
        if ctype == 0x4E4F534A: js = json.loads(chunk.decode('utf-8'))
        elif ctype == 0x004E4942: bin_ = chunk
        off += 8 + clen
    return js, bin_

CT = {5120:('b',1),5121:('B',1),5122:('h',2),5123:('H',2),5125:('I',4),5126:('f',4)}
NC = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}

def read_acc(j, b, i):
    a = j['accessors'][i]
    fmt, size = CT[a['componentType']]
    n = NC[a['type']]
    bv = j['bufferViews'][a['bufferView']]
    base = bv.get('byteOffset',0) + a.get('byteOffset',0)
    stride = bv.get('byteStride') or size*n
    out = []
    for k in range(a['count']):
        o = base + k*stride
        out.append(struct.unpack_from('<'+fmt*n, b, o))
    return out

# ── 4×4 矩阵（列主序，和 glTF 一致）──
def ident(): return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
def mul(a,b):
    r=[0]*16
    for c in range(4):
        for rw in range(4):
            r[c*4+rw] = sum(a[k*4+rw]*b[c*4+k] for k in range(4))
    return r
def trs(t,r,s):
    x,y,z,w = r
    xx,yy,zz = x*x,y*y,z*z
    m=[0]*16
    m[0]=(1-2*(yy+zz))*s[0]; m[1]=(2*(x*y+z*w))*s[0]; m[2]=(2*(x*z-y*w))*s[0]
    m[4]=(2*(x*y-z*w))*s[1]; m[5]=(1-2*(xx+zz))*s[1]; m[6]=(2*(y*z+x*w))*s[1]
    m[8]=(2*(x*z+y*w))*s[2]; m[9]=(2*(y*z-x*w))*s[2]; m[10]=(1-2*(xx+yy))*s[2]
    m[12],m[13],m[14]=t; m[15]=1
    return m
def node_local(nd):
    if 'matrix' in nd: return list(nd['matrix'])
    return trs(nd.get('translation',[0,0,0]), nd.get('rotation',[0,0,0,1]), nd.get('scale',[1,1,1]))
def xform(m,v):
    x,y,z=v
    return (m[0]*x+m[4]*y+m[8]*z+m[12],
            m[1]*x+m[5]*y+m[9]*z+m[13],
            m[2]*x+m[6]*y+m[10]*z+m[14])

def main(path):
    j,b = load_glb(path)
    print('文件:', path)
    print('meshes:', len(j.get('meshes',[])), '| skins:', len(j.get('skins',[])),
          '| animations:', len(j.get('animations',[])))

    # 节点世界矩阵
    parent = {}
    for i,nd in enumerate(j.get('nodes',[])):
        for c in nd.get('children',[]): parent[c]=i
    world = {}
    def get_world(i):
        if i in world: return world[i]
        m = node_local(j['nodes'][i])
        p = parent.get(i)
        r = mul(get_world(p), m) if p is not None else m
        world[i]=r; return r

    # 蒙皮矩阵：joint_world × inverseBindMatrix
    skin_mats = {}
    for si,sk in enumerate(j.get('skins',[])):
        ibm = read_acc(j,b,sk['inverseBindMatrices']) if 'inverseBindMatrices' in sk else [ident()]*len(sk['joints'])
        mats=[]
        for k,jn in enumerate(sk['joints']):
            m = [v for v in ibm[k]]
            mats.append(mul(get_world(jn), m))
        skin_mats[si]=mats

    lo=[1e9]*3; hi=[-1e9]*3
    rawlo=[1e9]*3; rawhi=[-1e9]*3
    nv=0
    for nd in j.get('nodes',[]):
        if 'mesh' not in nd: continue
        mesh = j['meshes'][nd['mesh']]
        for prim in mesh['primitives']:
            at = prim['attributes']
            posv = read_acc(j,b,at['POSITION'])
            for p in posv:
                for k in range(3):
                    rawlo[k]=min(rawlo[k],p[k]); rawhi[k]=max(rawhi[k],p[k])
            if 'JOINTS_0' in at and 'WEIGHTS_0' in at and 'skin' in nd:
                J = read_acc(j,b,at['JOINTS_0']); W = read_acc(j,b,at['WEIGHTS_0'])
                mats = skin_mats[nd['skin']]
                for vi,p in enumerate(posv):
                    x=y=z=0.0
                    for c in range(4):
                        w = W[vi][c]
                        if w == 0: continue
                        m = mats[J[vi][c]]
                        q = xform(m,p)
                        x+=w*q[0]; y+=w*q[1]; z+=w*q[2]
                    for k,v in enumerate((x,y,z)):
                        lo[k]=min(lo[k],v); hi[k]=max(hi[k],v)
                    nv+=1
            else:
                for p in posv:
                    for k in range(3):
                        lo[k]=min(lo[k],p[k]); hi[k]=max(hi[k],p[k])
                    nv+=1

    print(f'\n顶点数 {nv}')
    print('  POSITION accessor 的 min/max（绑定姿势原始几何）:')
    print(f'    min [{rawlo[0]:.4f}, {rawlo[1]:.4f}, {rawlo[2]:.4f}]')
    print(f'    max [{rawhi[0]:.4f}, {rawhi[1]:.4f}, {rawhi[2]:.4f}]')
    print(f'    尺寸 [{(rawhi[0]-rawlo[0]):.4f}, {(rawhi[1]-rawlo[1]):.4f}, {(rawhi[2]-rawlo[2]):.4f}]')
    print('  套骨骼后的真实包围盒（静止姿态）:')
    print(f'    min [{lo[0]:.4f}, {lo[1]:.4f}, {lo[2]:.4f}]')
    print(f'    max [{hi[0]:.4f}, {hi[1]:.4f}, {hi[2]:.4f}]')
    print(f'    尺寸 [{(hi[0]-lo[0]):.4f}, {(hi[1]-lo[1]):.4f}, {(hi[2]-lo[2]):.4f}]')
    print(f'\n  → 高度 {hi[1]-lo[1]:.4f}，底在 y={lo[1]:.4f}')

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv)>1 else '产出/prince-walk.glb')
