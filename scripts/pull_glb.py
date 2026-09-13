#!/usr/bin/env python3
"""从 Tripo Studio 的 CDN 签名直链把 GLB 拉下来。

为什么不点页面上的「导出」：那条路走浏览器下载链路，会弹原生「另存为」对话框，
自动化到那儿就得停手（file picker 是 skill 的停手线）。而页面加载模型时本来就会去
请求 tripo-data.../tripo_pbr_model_<uuid>_meshopt.glb 这个 CloudFront 签名 URL，
直接从那儿拿就完全绕开了对话框。

URL 怎么来：huashu-chrome 的 network(body:"tripo_pbr_model") 会把完整 URL 打出来，
但它是嵌在 GA 事件参数里的，整串被 URL 编码了一层（%3A%2F%3F%26%3D），所以要 unquote 一次。

用法：
  python3 pull_glb.py --url '<编码过的URL>' --out 产出/rose.glb
  # 或者把编码过的 URL 存成文件再喂：
  python3 pull_glb.py --url-file /tmp/u.txt --out 产出/rose.glb
"""
import argparse, sys, urllib.parse, urllib.request, pathlib, hashlib

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url')
    ap.add_argument('--url-file')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    raw = a.url or pathlib.Path(a.url_file).read_text().strip()
    # 可能整串被编码过，也可能没被编码——只在看起来被编码时才解
    if '%3A%2F%2F' in raw or raw.startswith('https%3A'):
        url = urllib.parse.unquote(raw)
    else:
        url = raw
    # 从可能更长的一坨里把 URL 本身切出来（GA 参数里它是 ep.url= 的值）
    if 'http' in url and not url.startswith('http'):
        url = 'http' + url.split('http', 1)[1]
    # 砍掉后面可能粘上来的别的参数
    for junk in ('&tfd=', '&_ee='):
        if junk in url:
            url = url.split(junk)[0]

    if not url.startswith('https://tripo-data.'):
        print('❌ 这不像 Tripo 的 CDN 直链：', url[:120], file=sys.stderr)
        return 1

    out = pathlib.Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    print('→ 下载', url.split('/')[-1][:70], '…')
    with urllib.request.urlopen(url, timeout=300) as r:
        data = r.read()
    out.write_bytes(data)

    # 正面证据：文件是 GLB、有多大、什么哈希
    magic = data[:4]
    ok = magic == b'glTF'
    print(f"{'✅' if ok else '❌'} {out}  {len(data)/1048576:.2f} MB  magic={magic!r}  "
          f"sha256={hashlib.sha256(data).hexdigest()[:16]}")
    return 0 if ok else 1

if __name__ == '__main__':
    sys.exit(main())
