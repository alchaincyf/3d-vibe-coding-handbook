import struct, zlib, sys, os

class Node:
    __slots__=('name','props','children')
    def __init__(s,n): s.name=n; s.props=[]; s.children=[]

def read_props(b, off, n):
    props=[]
    for _ in range(n):
        t = chr(b[off]); off+=1
        if t=='Y': props.append(struct.unpack_from('<h',b,off)[0]); off+=2
        elif t=='C': props.append(bool(b[off])); off+=1
        elif t=='I': props.append(struct.unpack_from('<i',b,off)[0]); off+=4
        elif t=='F': props.append(struct.unpack_from('<f',b,off)[0]); off+=4
        elif t=='D': props.append(struct.unpack_from('<d',b,off)[0]); off+=8
        elif t=='L': props.append(struct.unpack_from('<q',b,off)[0]); off+=8
        elif t in 'fdlib':
            ln,enc,cl = struct.unpack_from('<III',b,off); off+=12
            raw = b[off:off+cl]; off+=cl
            if enc==1: raw = zlib.decompress(raw)
            fmt = {'f':'f','d':'d','l':'q','i':'i','b':'b'}[t]
            props.append(('ARRAY',t,ln,raw if len(raw)<2_000_000 else None,fmt))
        elif t in 'SR':
            ln = struct.unpack_from('<I',b,off)[0]; off+=4
            data = b[off:off+ln]; off+=ln
            props.append(data.decode('utf-8','replace') if t=='S' else ('RAW',ln))
        else: raise ValueError('bad prop type '+t+' at '+str(off))
    return props, off

def parse(b, off, v):
    big = v >= 7500
    hs = 25 if big else 13
    fmt = '<QQQB' if big else '<IIIB'
    sz  = 25 if big else 13
    nodes=[]
    while True:
        end, nprop, plen, nlen = struct.unpack_from(fmt, b, off)
        if end==0 and nprop==0 and plen==0 and nlen==0:
            off += sz; break
        p = off + sz
        name = b[p:p+nlen].decode('utf-8','replace'); p += nlen
        n = Node(name)
        n.props, p = read_props(b, p, nprop)
        if p < end:
            n.children, p = parse(b, p, v)
        nodes.append(n)
        off = end
        if off >= len(b)-sz: break
    return nodes, off

path = sys.argv[1]
b = open(path,'rb').read()
assert b[:21]==b'Kaydara FBX Binary  \x00'
ver = struct.unpack_from('<I', b, 23)[0]
print(f"=== {path}")
print(f"file size {len(b):,} bytes | FBX version {ver} ({ver/1000:.1f})")
root,_ = parse(b, 27, ver)
top = {n.name:n for n in root}
print("top-level sections:", list(top.keys()))

# Creator
for n in root:
    if n.name=='Creator': print("Creator:", n.props[0])
if 'FBXHeaderExtension' in top:
    for c in top['FBXHeaderExtension'].children:
        if c.name in ('Creator','CreationTimeStamp'):
            pass

objs = top.get('Objects')
counts={}
geoms=[]; models=[]; mats=[]; texs=[]; vids=[]; poses=[]; defs=[]
if objs:
    for c in objs.children:
        counts[c.name]=counts.get(c.name,0)+1
        if c.name=='Geometry': geoms.append(c)
        elif c.name=='Model': models.append(c)
        elif c.name=='Material': mats.append(c)
        elif c.name=='Texture': texs.append(c)
        elif c.name=='Video': vids.append(c)
        elif c.name=='Deformer': defs.append(c)
print("\nObjects section counts:", counts)

def arr(node, child_name):
    for c in node.children:
        if c.name==child_name:
            for p in c.props:
                if isinstance(p,tuple) and p[0]=='ARRAY': return p
    return None

print(f"\n{'#':>3}  {'geometry name':<40} {'verts':>10} {'tris':>10}  {'polys':>8}")
print('-'*80)
tv=tt=tp=0
for i,g in enumerate(geoms):
    nm = g.props[1].split('\x00')[0] if len(g.props)>1 and isinstance(g.props[1],str) else '(?)'
    va = arr(g,'Vertices'); pa = arr(g,'PolygonVertexIndex')
    nv = va[2]//3 if va else 0
    ntri=0; npoly=0
    if pa and pa[3] is not None:
        idx = struct.unpack('<%d%s'%(pa[2],pa[4]), pa[3][:pa[2]*4])
        cnt=0
        for x in idx:
            cnt+=1
            if x<0:
                npoly+=1; ntri += cnt-2; cnt=0
    tv+=nv; tt+=ntri; tp+=npoly
    print(f"{i:>3}  {nm:<40} {nv:>10,} {ntri:>10,} {npoly:>8,}")
print('-'*80)
print(f"{'TOTAL':<45} {tv:>10,} {tt:>10,} {tp:>8,}")

print("\n-- Models (nodes):")
for m in models:
    nm = m.props[1].split('\x00')[0] if len(m.props)>1 else '?'
    typ = m.props[2] if len(m.props)>2 else '?'
    print(f"   {nm}  ({typ})")

print("\n-- Materials:")
for m in mats:
    nm = m.props[1].split('\x00')[0] if len(m.props)>1 else '?'
    sh = m.props[2] if len(m.props)>2 else '?'
    print(f"   {nm}  shading={sh}")

print("\n-- Textures / Videos (embedded images):")
for t in texs:
    nm = t.props[1].split('\x00')[0] if len(t.props)>1 else '?'
    rel=''
    for c in t.children:
        if c.name in ('RelativeFilename','FileName'): rel = str(c.props[0])
    print(f"   Texture {nm}  -> {rel}")

def img_size(d):
    if d[:8]==b'\x89PNG\r\n\x1a\n':
        w,h=struct.unpack_from('>II',d,16); return ('png',w,h)
    if d[:2]==b'\xff\xd8':
        i=2
        while i<len(d)-1:
            if d[i]!=0xFF: i+=1; continue
            m=d[i+1]
            if m in (0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF):
                h,w=struct.unpack_from('>HH',d,i+5); return ('jpeg',w,h)
            if m in (0xD8,0xD9) or 0xD0<=m<=0xD7: i+=2; continue
            ln=struct.unpack_from('>H',d,i+2)[0]; i+=2+ln
        return ('jpeg',None,None)
    return ('?',None,None)

for v in vids:
    nm = v.props[1].split('\x00')[0] if len(v.props)>1 else '?'
    fn=''; size=None; fmt=(None,None,None)
    for c in v.children:
        if c.name in ('RelativeFilename','Filename','FileName'): fn = str(c.props[0])
        if c.name=='Content':
            for p in c.props:
                if isinstance(p,tuple) and p[0]=='RAW': size=p[1]
    # re-read raw content bytes for dimension
    print(f"   Video {nm}  file={fn}  embedded={size:,} bytes" if size else f"   Video {nm}  file={fn}  (no embedded content)")

print("\n-- Deformers (skin/cluster):", [d.props[2] if len(d.props)>2 else '?' for d in defs] or 'none')
print("-- has AnimationStack:", 'AnimationStack' in counts, "| AnimationCurve:", counts.get('AnimationCurve',0))
print("-- Pose objects:", counts.get('Pose',0))
