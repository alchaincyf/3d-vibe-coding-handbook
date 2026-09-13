#!/bin/bash
# 把小王子星球的 Tripo 资产降档——**只降贴图，不动几何**。
#
# 为什么：Tripo 导出的是 8192² 的 PBR 贴图。17 个资产一共 31 张，其中
# 10 张 8192²、20 张 4096²，估算显存 5.0 GB（含 mipmap）。每个道具在画面里
# 才一两米高、屏幕上几百像素，却挂着 343MB 的贴图——GPU 一直在做纹理换入换出，
# 表现就是"卡顿"。实测这台 M4 Pro 上 GPU 渲染只要 0.37ms、JS 1.5ms，
# 所以瓶颈从来不在三角形数量，也不在后期链，**就在这 5GB 贴图上**。
#
# 参数来自本商单的《三模式实验》E2 那条已验证的流水线。
# 用 resize 而不是 optimize：optimize 默认还会跑 simplify 减面，
# 而几何本来就不是瓶颈，没有理由动它。
#
# 原始文件在 产出/，本脚本只写 网页/assets/tripo/，随时可以重跑或回退。
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="$ROOT/产出"
DST="$ROOT/网页/assets/tripo"
WORK=/tmp/gt-work

mkdir -p "$WORK" "$DST"
cd "$WORK"

if [ ! -x node_modules/.bin/gltf-transform ]; then
  echo "装 gltf-transform 到 $WORK（只装一次）…"
  npm i --silent --no-audit --no-fund @gltf-transform/cli@4.5.0
fi
GT="$WORK/node_modules/.bin/gltf-transform"

# 文件名 → 源文件（网页里的名字和产出里的不完全一样）
map() {
  case "$1" in
    rose)          echo "rose.glb" ;;
    baobab-sprout) echo "baobab-sprout.glb" ;;
    baobab)        echo "baobab.glb" ;;
    fox)           echo "fox.glb" ;;
    snake)         echo "snake.glb" ;;
    sheep)         echo "sheep.glb" ;;
    well)          echo "well.glb" ;;
    lamp)          echo "lamp.glb" ;;
    prince-rig)    echo "prince-rig.glb" ;;
    prince-anim)   echo "prince-anim.glb" ;;
    throne)        echo "throne.glb" ;;
    mirror)        echo "mirror.glb" ;;
    drunk-table)   echo "drunk-table.glb" ;;
    biz-desk)      echo "biz-desk.glb" ;;
    geo-desk)      echo "geo-desk.glb" ;;
    crate)         echo "crate.glb" ;;
    chair)         echo "chair.glb" ;;
  esac
}

NAMES="rose baobab-sprout baobab fox snake sheep well lamp prince-rig prince-anim throne mirror drunk-table biz-desk geo-desk crate chair"

printf '%-16s %10s %10s %7s\n' 资产 原 新 倍数
tot0=0; tot1=0
for n in $NAMES; do
  f=$(map "$n")
  [ -f "$SRC/$f" ] || { printf '%-16s 缺 %s\n' "$n" "$f"; continue; }
  # 主角是特写主角，给两倍分辨率；其余 1024² 在这个观看距离上富余很多
  if [ "$n" = "prince-rig" ]; then W=2048; else W=1024; fi
  "$GT" resize "$SRC/$f" "$DST/$n.glb" --width $W --height $W >/dev/null 2>&1
  a=$(stat -f%z "$SRC/$f"); b=$(stat -f%z "$DST/$n.glb")
  tot0=$((tot0+a)); tot1=$((tot1+b))
  printf '%-16s %8.2fMB %8.2fMB %6.1fx\n' "$n" "$(echo "$a/1048576"|bc -l)" "$(echo "$b/1048576"|bc -l)" "$(echo "$a/$b"|bc -l)"
done

echo
printf '合计 %.1fMB → %.1fMB（%.1f 倍）\n' "$(echo "$tot0/1048576"|bc -l)" "$(echo "$tot1/1048576"|bc -l)" "$(echo "$tot0/$tot1"|bc -l)"
du -sh "$DST"
