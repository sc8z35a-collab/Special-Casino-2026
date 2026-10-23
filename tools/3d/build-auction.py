#!/usr/bin/env python3
"""Build the supplied auction assets without changing the source GLBs.

python3 tools/3d/build-auction.py /path/to/uploads /path/to/gltf-transform
Uses @gltf-transform/cli 4.1.1 (the same version as build.sh).
The four opaque animation IDs were checked against the supplied skeletons:
left hand above head, head in hands, both hands celebrating, standing idle.
"""
import concurrent.futures
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile

CLIPS = {
    '_01a1638f_2bcb_700d_8d3a_f194111e7767': 'bid',
    '_01a16391_e552_76c0_bb2d_81744e3e9327': 'lose',
    '_01a16393_ee48_70ae_babf_4bbe4e176ca9': 'win',
    '_01a16395_9a38_745a_87ab_995c42151e60': 'idle',
}
JOBS = [
    ('デニス', 'dennis', .35), ('ジョウモンさん', 'joumon', .35),
    ('ナターシャ', 'natasha', .35), ('ミスタースミスジョンソン', 'johnson', .35),
    ('神谷社長', 'kamiya', .35), ('野生を生きる男', 'wild', .35),
    ('競り場', 'room', .09), ('教卓', 'lectern', .25),
    ('ローポリ種', 'seed', .22), ('ローポリプレビュー木', 'tree', .10),
]


def prepare(src, dst, character):
    data = src.read_bytes()
    size = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + size])
    if character:
        clips = []
        for clip in doc.get('animations', []):
            if clip['name'] in CLIPS:
                clip['name'] = CLIPS[clip['name']]
                clips.append(clip)
        if {c['name'] for c in clips} != set(CLIPS.values()):
            raise ValueError(f'{src.name}: four auction clips are required')
        doc['animations'] = clips
    encoded = json.dumps(doc, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    rest = data[20 + size:]
    dst.write_bytes(struct.pack('<III', 0x46546c67, 2, 20 + len(encoded) + len(rest))
                    + struct.pack('<II', len(encoded), 0x4e4f534a) + encoded + rest)


def main():
    source = Path(sys.argv[1]).resolve()
    cli = str(Path(sys.argv[2]).resolve())
    output = Path(__file__).resolve().parents[2] / 'img/3d/auction'
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temp:
        def build(job):
            name, slug, ratio = job
            staged = Path(temp) / f'{slug}.glb'
            prepare(source / f'{name}.glb', staged, slug not in {'room', 'lectern', 'seed', 'tree'})
            dest = output / f'{slug}.glb'
            result = subprocess.run([cli, 'optimize', str(staged), str(dest),
                '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '1024',
                '--simplify', 'true', '--simplify-ratio', str(ratio), '--simplify-error', '0.0008'],
                capture_output=True, text=True)
            if result.returncode:
                raise RuntimeError(result.stderr + result.stdout)
            print(f'{slug}: {dest.stat().st_size:,} bytes', flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(build, JOBS))
    # Byte-for-byte parts keep source-control transfers small without reducing
    # model quality. The client reconstructs the original GLB before decoding.
    catalog = {}
    for _, slug, _ in JOBS:
        file = output / f'{slug}.glb'
        data = file.read_bytes()
        for old in output.glob(f'{slug}.*.bin'):
            old.unlink()
        if len(data) > 300000:
            names = []
            for index, start in enumerate(range(0, len(data), 245760)):
                name = f'{slug}.{index}.bin'
                (output / name).write_bytes(data[start:start + 245760])
                names.append(name)
            file.unlink()
        else:
            names = [file.name]
        catalog[slug] = {'files': names, 'bytes': len(data)}
    (output / 'assets.json').write_text(json.dumps(catalog, indent=2) + '\n')


if __name__ == '__main__':
    main()
