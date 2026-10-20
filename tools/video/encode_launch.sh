#!/bin/sh
# The studio logos of the game (needs ffmpeg), played at every launch without a skip:
#   video/studio.mp4 (+ -lite)
# The sound is levelled to -16 LUFS (the logo recording is very loud).
#   sh tools/video/encode_launch.sh
set -e
cd "$(dirname "$0")/../.."
STUDIO=tools/video/source/studio-source.mp4
AF="loudnorm=I=-16:TP=-1.5:LRA=11"
ffmpeg -y -i "$STUDIO" -vf "scale=1280:720:flags=lanczos,format=yuv420p" -c:v libx264 -profile:v high -preset slow -crf 23 \
  -af "$AF" -c:a aac -b:a 128k -ar 44100 -movflags +faststart video/studio.mp4
ffmpeg -y -i "$STUDIO" -vf "scale=854:480:flags=lanczos,format=yuv420p" -c:v libx264 -profile:v high -preset slow -crf 29 \
  -af "$AF" -c:a aac -b:a 96k -ar 44100 -movflags +faststart video/studio-lite.mp4
