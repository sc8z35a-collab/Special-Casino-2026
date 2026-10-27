"""Reproduce checked-in Opus/WebM alternatives without changing originals.
Requires ffmpeg/ffprobe. Default: verify sizes/metadata and regenerate the report.
Pass --encode to re-encode first. Unreferenced title alternatives stay out of dist.
"""
import hashlib, json, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
AUDIO = ['bgm-title.mp3', 'click.wav', 'coins.mp3', 'money.mp3', 'peter-1.mp3', 'peter-2.mp3', 'reels.wav', 'register-high.mp3', 'register.mp3', 'spin-button.wav', 'win.mp3']
VIDEO = ['title', 'title-lite', 'studio-low']
def run(args): return subprocess.check_output(args, text=True)
def probe(p):
 d=json.loads(run(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(p)]));s=d['streams'][0]
 return {k:s[k] for k in ['codec_name','width','height','channels','sample_rate'] if k in s} | {'duration':float(d['format']['duration'])}
rows=[]
for name in AUDIO + [n+'.mp4' for n in VIDEO]:
 audio=name in AUDIO; src=ROOT/('sounds' if audio else 'video')/name; dst=src.with_suffix('.opus' if audio else '.webm')
 if '--encode' in sys.argv:
  options=['-c:a','libopus','-b:a','80k' if name=='bgm-title.mp3' else '64k','-vbr','on','-compression_level','10'] if audio else ['-an','-c:v','libvpx-vp9','-crf','45' if name=='title-lite.mp4' else '40','-b:v','0','-deadline','good','-cpu-used','5','-row-mt','1']
  subprocess.run(['ffmpeg','-y','-v','error','-i',str(src),*options,'-threads','2',str(dst)],check=True)
 a,b=probe(src),probe(dst)
 assert dst.stat().st_size<src.stat().st_size,(src,dst)
 assert abs(a['duration']-b['duration'])<.15,(a,b)
 for field in (['channels'] if audio else ['width','height']): assert a[field]==b[field]
 row={'source':str(src.relative_to(ROOT)),'alternative':str(dst.relative_to(ROOT)),'before':src.stat().st_size,'after':dst.stat().st_size,'sourceMetadata':a,'metadata':b,'sha256':hashlib.sha256(dst.read_bytes()).hexdigest(),'distributed':audio or name=='studio-low.mp4'}
 if not audio:
  result=subprocess.run(['ffmpeg','-hide_banner','-i',str(src),'-i',str(dst),'-lavfi','[0:v]fps=1[a];[1:v]fps=1[b];[a][b]ssim','-an','-f','null','-'],capture_output=True,text=True,check=True)
  import re
  row['ssim']=float(re.search(r'All:([\d.]+)',result.stderr).group(1))
 rows.append(row)
report={'tools':'ffmpeg libopus VBR / libvpx-vp9; originals retained, browser codec/decode fallback','files':rows,'before':sum(r['before'] for r in rows),'after':sum(r['after'] for r in rows),'distributedAlternativeBytes':sum(r['after'] for r in rows if r['distributed'])}
(ROOT/'docs/media-optimization.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='files'}))
