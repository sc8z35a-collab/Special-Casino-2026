"""Builds the game's sound files in sounds/ from the supplied recordings.

    python3 tools/sound/sounds.py        (needs ffmpeg)

source/click.mp3        基本クリック音             -> sounds/click.wav
source/spin-button.mp3  スロット回す時のボタン音   -> sounds/spin-button.wav
source/reels.mp3        スロット回し音             -> sounds/reels.wav (exactly two tick cycles, loops seamlessly)
source/win.mp3          スロットあたり音           -> sounds/win.mp3
source/bgm-nichinichi.mp3  タイトル画面の BGM       -> sounds/bgm-title.mp3 (the game plays it quieter)
source/peter-offer*.mp3    ピーターの声             -> sounds/peter-1.mp3, peter-2.mp3 (trimmed, levelled to -16 LUFS)

The recordings are very quiet and the two button sounds start after a
pause, so they are trimmed to their onset and brought to -1 dBFS peak.
Short sounds are written as WAV: MP3 adds a decoder delay that would lag
taps and break the loop length.
"""
import os
import subprocess
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(HERE, 'source')
OUT = os.path.join(ROOT, 'sounds')
SR = 44100
PEAK = 10 ** (-1 / 20)


def decode(name):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', os.path.join(SRC, name), '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def onset(x, floor_db=-60):
    return int(np.argmax(20 * np.log10(np.abs(x) + 1e-9) > floor_db))


def end(x, floor_db=-60):
    return len(x) - int(np.argmax(20 * np.log10(np.abs(x[::-1]) + 1e-9) > floor_db))


def fade(x, fin=0.002, fout=0.02):
    n_in, n_out = int(fin * SR), int(fout * SR)
    if n_in:
        x[:n_in] *= np.linspace(0, 1, n_in)
    if n_out:
        x[-n_out:] *= np.linspace(1, 0, n_out)
    return x


def normalize(x):
    return x * (PEAK / max(1e-9, float(np.abs(x).max())))


def write_wav(x, name):
    path = os.path.join(OUT, name)
    pcm = np.clip(np.round(x * 32767), -32768, 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    report(path, x)


def write_mp3(x, name):
    path = os.path.join(OUT, name)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-',
                    '-c:a', 'libmp3lame', '-b:a', '112k', path], input=x.astype(np.float32).tobytes(), check=True)
    report(path, x)


def report(path, x):
    print('wrote %s %.3fs (%d KiB)' % (os.path.relpath(path, ROOT), len(x) / SR, os.path.getsize(path) // 1024))


def quietest(x, lo, hi, win=0.001):
    """Start of the quietest `win`-long window between samples lo and hi."""
    n = int(win * SR)
    e = np.convolve(x[lo:hi] ** 2, np.ones(n), 'valid')
    return lo + int(np.argmin(e))


def tick_onsets(x, floor_db=-40, gap=0.015):
    """Starts of the reel ticks in a normalized recording (sound after at least `gap` of quiet)."""
    hop = int(0.002 * SR)
    env = np.sqrt(np.convolve(x * x, np.ones(hop) / hop, 'same'))
    loud = 20 * np.log10(env + 1e-9) > floor_db
    out, last = [], -10 ** 9
    for i in np.nonzero(loud)[0]:
        if i - last > gap * SR:
            out.append(int(i))
        last = i
    return out


def main():
    os.makedirs(OUT, exist_ok=True)

    for src, name in (('click.mp3', 'click.wav'), ('spin-button.mp3', 'spin-button.wav')):
        x = decode(src)
        a, b = max(0, onset(x) - int(0.003 * SR)), min(len(x), end(x) + int(0.03 * SR))
        write_wav(fade(normalize(x[a:b]), 0.001, 0.03), name)

    # reels: ticks come in a five-tick cycle (~0.44 s); keep two whole cycles
    # cut in the quiet just before a tick, so the loop seam is inaudible
    x = normalize(decode('reels.mp3'))
    ticks = tick_onsets(x)
    first = 1                      # the first tick is the start of the recording
    a = quietest(x, ticks[first] - int(0.03 * SR), ticks[first] - int(0.002 * SR))
    last = first + 10
    b = a + (ticks[last] - ticks[first])
    print('reel ticks at', [round(t / SR, 3) for t in ticks], '-> loop %.4f-%.4f s' % (a / SR, b / SR))
    write_wav(x[a:b].copy(), 'reels.wav')

    x = decode('win.mp3')
    write_mp3(fade(normalize(x[:end(x) + int(0.05 * SR)]), 0.0, 0.08), 'win.mp3')

    # title music: stereo as supplied, a little smaller
    ffmpeg('bgm-nichinichi.mp3', 'bgm-title.mp3', ['-c:a', 'libmp3lame', '-b:a', '112k', '-ar', str(SR)])
    # Peter's lines: quiet recordings with silence around them
    trim = ('silenceremove=start_periods=1:start_threshold=-50dB,areverse,'
            'silenceremove=start_periods=1:start_threshold=-50dB,areverse,'
            'loudnorm=I=-16:TP=-1.5:LRA=11,apad=pad_dur=0.15')
    for n in (1, 2):
        ffmpeg('peter-offer%d.mp3' % n, 'peter-%d.mp3' % n, ['-af', trim, '-ac', '1', '-ar', str(SR), '-c:a', 'libmp3lame', '-b:a', '80k'])


def ffmpeg(src, name, args):
    path = os.path.join(OUT, name)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', os.path.join(SRC, src)] + args + [path], check=True)
    print('wrote %s (%d KiB)' % (os.path.relpath(path, ROOT), os.path.getsize(path) // 1024))


if __name__ == '__main__':
    main()
