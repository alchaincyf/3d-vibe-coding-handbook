#!/usr/bin/env python3
"""逐个道具拍自校验图 + 量尺寸，用无头 Chrome，不占用花叔的浏览器。

为什么不用 huashu-chrome：后台标签页里 Chrome 会把定时器节流到每分钟一次，
rAF 直接停掉，画面帧永远冻在最后一帧，截图拿到的是旧画布。无头 Chrome 没有
这个问题（它算"可见"），rAF 正常跑。

两个坑写在这里免得下次再踩：
1. **默认 dayT=0.66 是夜晚**——太阳在地平线下，拍出来全黑没法看比例。
   SUN_DIR 的 y = sin(dayT·2π)·0.52 + 0.34，dayT=0.25 时才最高。
   验收姿势必须是白天：中性光 + 正面 + 退到看得见整体。
2. **别拿截图估尺寸。** 大人看起来比主角大好几倍，很可能只是它站在相机
   这一侧、离镜头更近。比例只能从包围盒和离地间隙里读。

用法：python3 selfcheck_props.py
"""
import sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / '截图' / '自检-道具'
PORT = 8794

# (文件名, 模式, 星球序号, 道具纬度, 道具经度, 相机距离, 相机偏航)
# 纬度/经度抄自 index.html 里各 case 的 land(makeX(), lat, lon) 那一行。
# 每颗星球的 spawn 在 lat 0 / 各自的 lon，道具在 lat 34~40——所以瞬移到道具那儿，
# 相机再退到能看见道具+主角的距离。yaw 让镜头从侧面看，避开大人的遮挡。
SHOTS = [
    ('A-玫瑰',           0, None, 12,  30, 8.0, 0.0),
    ('B-国王-王座',       1, 1,    40,   0, 7.0, 0.0),
    ('B-虚荣者-镜子',     1, 2,    36,   0, 6.0, 0.0),
    ('B-酒鬼-酒瓶桌',     1, 3,    34,   0, 6.0, 0.0),
    ('B-商人-书桌',       1, 4,    34,   0, 7.0, 0.0),
    ('B-点灯人-路灯',     1, 5,    40,   0, 6.0, 0.0),
    ('B-地理学家-书桌',   1, 6,    34,   0, 7.5, 0.0),
]

# 量这一屏里每个东西的真实尺寸，以及它离地多少。
# 离地间隙是关键：buildB 的 land() 只按中心点取高度、sink 固定 0.10，
# 而 buildA 的 land() 会沿足迹采一圈最低点。两者行为不同，必须分别验。
MEASURE = """([wi])=>{
  const X=window.__x, T=X.THREE, W=X.WORLD.now;
  // 观 B 是 {worlds:[…]}；观 A/C 自己就是世界（buildA 只给了 center/R，
  // 没有 hf 也没有 payload——元素都在闭包里，外面拿不到）。
  const w = W.worlds ? ((wi===null||wi===undefined) ? W.worlds[0] : W.worlds[wi]) : W;

  // ⚠️ 两个量法陷阱，都踩过：
  // ① 别用 Box3.setFromObject。道具是被球面法线旋转着种上去的，
  //    轴对齐包围盒会被旋转撑大。只在**物体自己的上轴**上逐顶点投影才是真高度。
  // ② 必须 traverseVisible，不能 traverse。orProcedural 换 Tripo 模型时
  //    只把程序化占位件 visible=false，**没有从图里摘掉**，而 traverse 和
  //    setFromObject 都会照算——量出来的是"新模型 ∪ 藏起来的旧造型"，
  //    王座因此虚高 1.47 倍（真值 1.90，量成 2.80）。
  // 蒙皮网格还要先过 applyBoneTransform，否则量到的是绑定姿势。
  const upOf=(o)=>{ const q=new T.Quaternion(); o.getWorldQuaternion(q);
                    return new T.Vector3(0,1,0).applyQuaternion(q).normalize(); };
  // 主角的朝向上在 heroYaw 上，hero 只拿位置（四元数恒为单位阵）——
  // 取错了会一直沿世界 Y 量，人在球面上是斜的，凭空少掉三成。
  const HERO_UP = upOf(X.heroYaw);
  const ext=(o, up)=>{
    // 蒙皮网格必须先刷新 bindMatrixInverse：three.js 只在 updateMatrixWorld() 里做，
    // 而 SkinnedMesh 重写的是它、不是 updateWorldMatrix。少这一句量出来是假的。
    o.updateWorldMatrix(true,true); o.updateMatrixWorld(true);
    const p=new T.Vector3(), q=new T.Vector3();
    let lo=1e9, hi=-1e9;
    o.traverseVisible(n=>{
      if(!n.isMesh || !n.geometry) return;
      const at=n.geometry.attributes.position; if(!at) return;
      const step=Math.max(1,Math.floor(at.count/3000));
      for(let i=0;i<at.count;i+=step){
        p.fromBufferAttribute(at,i);
        if(n.isSkinnedMesh && n.applyBoneTransform) n.applyBoneTransform(i,p);
        q.copy(p).applyMatrix4(n.matrixWorld);
        const h=q.dot(up);
        if(h<lo)lo=h; if(h>hi)hi=h;
      }
    });
    return {h:+(hi-lo).toFixed(3), lo:+lo.toFixed(3)};
  };
  const rows=[];
  const p=w.payload||{};
  if(!Object.keys(p).length) rows.push('(这个世界没有暴露 payload——观 A/C 的元素都在闭包里)');
  const one=(label,o,up)=>{
    const ax = up || upOf(o);
    const v=new T.Vector3(); o.getWorldPosition(v);
    const e=ext(o, ax);
    // 锚点就是 land() 种下去的那个点。物体局部底在 y=0，所以
    // "伸出锚点多少米" = lo − 锚点高度；负数就是埋进去了。
    const anchor = v.dot(ax);
    rows.push(`${label}  真高 ${e.h} m   局部底相对锚点 ${(e.lo-anchor).toFixed(3)} m  (负=埋进地里)`);
  };
  for(const k of Object.keys(p)){
    const o=p[k]; if(!o) continue;
    (Array.isArray(o)?o:[o]).forEach((x,idx)=>{ if(x&&x.getWorldPosition) one(`${k}${Array.isArray(o)&&o.length>1?'#'+idx:''}`, x); });
  }
  one('★ 主角(hero)', X.hero, HERO_UP);
  return rows;
}"""


def main():
    from playwright.sync_api import sync_playwright

    OUT.mkdir(parents=True, exist_ok=True)
    errs = []
    with sync_playwright() as p:
        # channel="chrome" 用本机装好的 Chrome，不下载 playwright 自带浏览器
        b = p.chromium.launch(channel='chrome', headless=True)
        pg = b.new_page(viewport={'width': 1600, 'height': 900})
        pg.on('console', lambda m: errs.append(f'[{m.type}] {m.text}') if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append(f'[pageerror] {e}'))

        pg.goto(f'http://127.0.0.1:{PORT}/', wait_until='load')
        pg.wait_for_function("()=>/资产到位/.test(document.body.innerText)", timeout=90_000)
        print('资产状态:', pg.evaluate("()=>document.body.innerText.match(/资产到位[^\\n]*/)[0]"))

        # 分母：每个 Tripo 模型被 normalize() 之后的实际尺寸。
        # ⚠️ ASSETS 第三列不是"高度"——normalize 用的是 target / max(x,y,z)，
        # 是**最大边**。宽扁的东西（桌子）会按宽度定标，高度随模型自身比例漂。
        print('\n── Tripo 模型归一化后的实际包围盒（ASSETS 第三列 = 最大边，不是高度）──')
        for k, v in pg.evaluate('()=>window.__tri()').items():
            flag = '  ← 最大边是宽度/深度，高度不受控' if max(v['w'], v['h'], v['d']) == max(v['w'], v['d']) and v['h'] < v['w'] * 0.999 else ''
            print(f'  {k:14s} 宽{v["w"]:6.2f} 高{v["h"]:6.2f} 深{v["d"]:6.2f}{flag}')

        pg.evaluate("()=>window.__set({dayT:0.25})")          # 白天
        pg.eval_on_selector('#enter .card[data-m="1"]', 'el=>el.click()')
        pg.wait_for_timeout(900)

        for name, mode, wi, lat, lon, dist, yaw in SHOTS:
            ok = pg.evaluate("""([mode,wi,lat,lon,dist,yaw])=>{
                const X=window.__x;
                if(X.WORLD.cur!==mode) window.__set({mode:mode});
                const w=X.WORLD.now;
                if(wi!==null && w.worlds && w.worlds[wi]){
                    w.surf = w.worlds[wi].surf;      // 把"当前面"换成目标星球，__goto 就落在那颗上
                    X.P.surf = w.worlds[wi].surf;
                }
                const r=window.__goto(lat,lon);
                window.__set({dist:dist, pitch:0.10, yaw:yaw});
                return r;
            }""", [mode, wi, lat, lon, dist, yaw])

            pg.wait_for_timeout(1400)                          # 相机是平滑跟的，等几帧再拍
            print(f'\n── {name} ──')
            for r in pg.evaluate(MEASURE, [wi]):
                print('   ', r)
            pg.screenshot(path=str(OUT / f'{name}.png'))
            print(f'   {"ok" if ok else "FAIL"} → {name}.png')

        # 观 C（一本书）不是球面，__goto 用不了——只切模式，用它的默认机位。
        # A/C 两观的元素都在闭包里量不到，这里只留一张图给人眼看。
        pg.evaluate("()=>window.__set({mode:2, dayT:0.25, dist:11, pitch:0.22})")
        pg.wait_for_timeout(1600)
        pg.screenshot(path=str(OUT / 'C-一本书.png'))
        print('\n── C-一本书 ──  (非球面，只出图不量)  → C-一本书.png')

        b.close()

    print()
    if errs:
        print('⚠️ 控制台错误:')
        for e in dict.fromkeys(errs):
            print('  ', e)
    else:
        print('✅ 无控制台错误')
    return 0


if __name__ == '__main__':
    sys.exit(main())
