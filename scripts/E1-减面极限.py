import subprocess, struct, json, os, glob
ASSETS = "../paris-demo/assets"
GROUP = {
 '建筑': ['building-01-corner','building-03-boulangerie','haussmann-building-lowpoly'],
 '地标': ['eiffel-tower'],
 '载具': ['citroen-2cv','car-01-taxi'],
 '人物': ['pedestrian-01-man-suit','pedestrian-05-painter'],
 '道具': ['prop-02-bench','prop-cafe-shop'],
 '植被': ['tree-01-plane-green'],
}
def tris(p):
    with open(p,'rb') as f:
        f.read(12); cl,ct=struct.unpack('<II',f.read(8)); j=json.loads(f.read(cl))
    return sum(j['accessors'][pr['indices']]['count']//3 for m in j['meshes'] for pr in m['primitives'] if 'indices' in pr)
RATIOS = [0.5, 0.2, 0.1, 0.05, 0.02]
print(f"{'资产':26s}{'原始':>7s}" + "".join(f"{('r'+str(r)):>8s}" for r in RATIOS) + f"{'下限':>8s}{'下限%':>8s}")
for g, names in GROUP.items():
    for n in names:
        src = f"{ASSETS}/{n}.glb"
        if not os.path.exists(src): continue
        orig = tris(src); row = []
        for r in RATIOS:
            out = f"/tmp/e1-{n}-{r}.glb"
            subprocess.run(['npx','--yes','@gltf-transform/cli','simplify',src,out,'--ratio',str(r),'--error','1'],
                           capture_output=True)
            row.append(tris(out) if os.path.exists(out) else -1)
        floor = min([v for v in row if v > 0] or [orig])
        print(f"{n[:25]:26s}{orig:>7d}" + "".join(f"{v:>8d}" for v in row) + f"{floor:>8d}{floor/orig*100:>7.1f}%")
