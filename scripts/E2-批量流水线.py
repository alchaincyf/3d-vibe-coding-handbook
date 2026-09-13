import subprocess, struct, json, os, glob, time
SRC="../paris-demo/assets"; OUT="E2-批量流水线/out"
# 按 E1 实测的减面友好度分配比例：人/载具/道具敢砍，建筑/地标/植被保守
def ratio_for(n):
    if n.startswith('pedestrian') or n.startswith('car') or n=='citroen-2cv' or n.startswith('prop'): return 0.25
    if n.startswith('tree') or n=='eiffel-tower': return 0.75
    return 0.45
def stat(p):
    if not os.path.exists(p): return 0,0
    with open(p,'rb') as f:
        f.read(12); cl,ct=struct.unpack('<II',f.read(8)); j=json.loads(f.read(cl))
    t=sum(j['accessors'][pr['indices']]['count']//3 for m in j['meshes'] for pr in m['primitives'] if 'indices' in pr)
    return t, os.path.getsize(p)//1024
files=sorted(glob.glob(f"{SRC}/*.glb"))
t_start=time.time(); tot_in=tot_out=0; rows=[]
for src in files:
    n=os.path.basename(src)[:-4]; r=ratio_for(n)
    tmp=f"/tmp/e2-{n}.glb"; dst=f"{OUT}/{n}.glb"
    subprocess.run(['npx','--yes','@gltf-transform/cli','simplify',src,tmp,'--ratio',str(r),'--error','1'],capture_output=True)
    subprocess.run(['npx','--yes','@gltf-transform/cli','optimize',tmp,dst,'--compress','quantize','--texture-size','512'],capture_output=True)
    ti,si=stat(src); to,so=stat(dst); tot_in+=si; tot_out+=so
    rows.append((n,r,ti,to,si,so))
t_end=time.time()
print(f"{'资产':30s}{'ratio':>6s}{'面数':>9s}{'→':>3s}{'面数':>8s}{'体积KB':>9s}{'→':>3s}{'KB':>7s}")
for n,r,ti,to,si,so in rows:
    print(f"{n[:29]:30s}{r:>6.2f}{ti:>9d}{'→':>3s}{to:>8d}{si:>9d}{'→':>3s}{so:>7d}")
print(f"\n合计: {len(files)} 个资产  {tot_in}KB → {tot_out}KB (减 {100-tot_out/tot_in*100:.0f}%)  总耗时 {t_end-t_start:.0f}s  平均 {(t_end-t_start)/len(files):.1f}s/个")
