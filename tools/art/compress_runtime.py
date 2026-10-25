"""Import the supplied update/tier/app artwork and optimize runtime icons.

Usage: python tools/art/compress_runtime.py /path/to/attachments /path/to/pngquant
Only runtime copies are touched. Upload originals stay unchanged.
"""
import io,json,subprocess,sys,tempfile
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
TIERS=[('ノーマルレア度(1).png','green'),('名称未設定のデザイン (7)(5).png','blue'),('名称未設定のデザイン (6)(5).png','purple'),('名称未設定のデザイン (14)(3).png','orange'),('名称未設定のデザイン (10)(2).png','gold'),('名称未設定のデザイン (5)(4).png','red'),('名称未設定のデザイン (11)(5).png','red-gold'),('名称未設定のデザイン (13)(4).png','aqua-purple'),('名称未設定のデザイン (15)(5).png','dark')]
DIRS=['img','icons','ops/assets','sec','app/android/app/src/main/res']
def files():
 return sorted({p for d in DIRS for p in (ROOT/d).rglob('*') if p.suffix.lower() in ['.webp','.png']})
def webp(im,quality=60):
 out=io.BytesIO();im.save(out,'WEBP',quality=quality,method=6,alpha_quality=95,exact=True);return out.getvalue()
def main():
 source=Path(sys.argv[1]);pngquant=sys.argv[2]
 before={str(p.relative_to(ROOT)):p.stat().st_size for p in files()}
 for name,tier in TIERS:
  im=Image.open(source/name).convert('RGBA');im=im.crop(im.getchannel('A').getbbox());im.thumbnail((640,240),Image.Resampling.LANCZOS)
  (ROOT/f'img/ui/quest-tiers/{tier}.webp').write_bytes(webp(im,68))
 im=Image.open(source/'名称未設定のデザイン (8)(2).png').convert('RGBA');im=im.crop(im.getchannel('A').getbbox());im.thumbnail((480,160),Image.Resampling.LANCZOS)
 (ROOT/'img/ui/refresh/update.webp').write_bytes(webp(im,74))
 subprocess.run([sys.executable,str(ROOT/'tools/art/import_app_icon.py'),str(source/'名称未設定のデザイン (11)(6).png')],check=True)
 rows=[]
 with tempfile.TemporaryDirectory() as tmp:
  for p in files():
   rel=str(p.relative_to(ROOT));old=p.read_bytes();im=Image.open(p).convert('RGBA');size=im.size
   if p.suffix=='.webp':
    # Large artwork remains larger than HUD icons; slot symbols are tiny on screen.
    if 'quest-tiers' in rel or rel.endswith('/update.webp'):limit=640
    elif 'wallpaper' in rel or any(x in rel for x in ['/bg.','/home.','/background.','/title.','/maintenance.']):limit=1280
    elif 'frame' in rel:limit=1164
    elif rel=='img/ui/fire.webp':limit=960
    elif any(x in rel for x in ['banner','combo','fever']):limit=768
    elif '/symbols/' in rel:limit=384
    else:limit=384
    im.thumbnail((limit,limit),Image.Resampling.LANCZOS)
    if rel=='img/ui/fire.webp':im=im.resize((4*round(im.width/4),6*round(im.height/6)),Image.Resampling.LANCZOS)
    candidate=webp(im,60)
   else:
    target=Path(tmp)/'image.png'
    result=subprocess.run([pngquant,'--quality=72-94','--speed','1','--strip','--force','--output',str(target),'256',str(p)],capture_output=True)
    candidate=target.read_bytes() if result.returncode==0 else old
   if len(candidate)<len(old)*.98:
    Image.open(io.BytesIO(candidate)).verify();p.write_bytes(candidate)
   final=Image.open(p)
   rows.append(dict(path=rel,before=before.get(rel,0),after=p.stat().st_size,beforeSize=size,afterSize=final.size))
 report=dict(files=len(rows),before=sum(r['before'] for r in rows),after=sum(r['after'] for r in rows),images=rows)
 (ROOT/'docs/image-compression.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({k:report[k] for k in ['files','before','after']}))
if __name__=='__main__':main()
