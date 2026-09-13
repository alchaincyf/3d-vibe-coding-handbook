# -*- coding: utf-8 -*-
"""在 Blender 里把 GLB 渲成四视图拼图，用来肉眼确认「贴图没贴歪、朝向是哪一边」。
纯本地、不开浏览器。

用法：
  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
      --python render_glb.py -- <in.glb> <out.png> [px]

四个机位按 **glTF 约定**（Y 上、-Z 为「前」）：
  +Z(后)  -Z(前)  +X(右)  斜 45°
每格左下角的坐标轴提示写在文件名旁边的说明里。
"""
import bpy, sys, os, math, mathutils

argv = sys.argv[sys.argv.index('--') + 1:]
glb, out = argv[0], argv[1]
PX = int(argv[2]) if len(argv) > 2 else 512

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)

objs = [o for o in bpy.data.objects if o.type == 'MESH']
if not objs:
    raise SystemExit('GLB 里没有网格')

# 世界包围盒（Blender Z-up）
mn = mathutils.Vector((1e9,) * 3); mx = mathutils.Vector((-1e9,) * 3)
for ob in objs:
    for c in ob.bound_box:
        w = ob.matrix_world @ mathutils.Vector(c)
        for k in range(3):
            mn[k] = min(mn[k], w[k]); mx[k] = max(mx[k], w[k])
center = (mn + mx) / 2
radius = max((mx - mn)) * 0.62 + 1e-6

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'          # 后台无 GPU 也能跑
sh = scene.display.shading
sh.light = 'STUDIO'
sh.color_type = 'TEXTURE'                          # 就是要看贴图
sh.show_specular_highlight = True
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new('w')
scene.world.color = (0.16, 0.16, 0.17)
scene.render.resolution_x = PX
scene.render.resolution_y = PX
scene.render.image_settings.file_format = 'PNG'

cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = radius * 2
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

# glTF 的 (X, Y, Z) 对应 Blender 的 (X, -Z, Y)
def gltf_dir(gx, gy, gz):
    return mathutils.Vector((gx, -gz, gy)).normalized()

VIEWS = [
    ('-Z', gltf_dir(0, 0, -1)),
    ('+X', gltf_dir(1, 0, 0)),
    ('+Z', gltf_dir(0, 0, 1)),
    ('-X', gltf_dir(-1, 0, 0)),
    ('+Y top', gltf_dir(0, 1, 0.0001)),
    ('iso', gltf_dir(-1, 0.6, -1)),
]

tiles = []
for i, (name, d) in enumerate(VIEWS):
    cam.location = center + d * (radius * 4)
    look = (center - cam.location).normalized()
    cam.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()
    p = out.replace('.png', '_%d.png' % i)
    scene.render.filepath = p
    bpy.ops.render.render(write_still=True)
    tiles.append((name, p))
    print('### tile %d %s -> %s' % (i, name, p))

print('### views=%s' % ' | '.join(n for n, _ in tiles))
print('### bbox_zup min=%s max=%s' % (tuple(round(v, 6) for v in mn), tuple(round(v, 6) for v in mx)))
