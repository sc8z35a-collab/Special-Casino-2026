#!/bin/sh
# The two other videos of the game (needs ffmpeg):
#   video/studio.mp4 (+ -lite)  the studio logos, played at every launch without a skip
#   video/intro.mp4             the story, played once after signing up (skippable)
# The sound is levelled to -16 LUFS (the logo recording is very loud).
# The 23 MB intro recording is not kept in the repository: pass its path.
#   sh tools/video/encode_launch.sh [intro-recording.mp4]
set -e
cd "$(dirname "$0")/../.."
STUDIO=tools/video/source/studio-source.mp4
AF="loudnorm=I=-16:TP=-1.5:LRA=11"
ffmpeg -y -i "$STUDIO" -vf "scale=1280:720:flags=lanczos,format=yuv420p" -c:v libx264 -profile:v high -preset slow -crf 23 \
  -af "$AF" -c:a aac -b:a 128k -ar 44100 -movflags +faststart video/studio.mp4
ffmpeg -y -i "$STUDIO" -vf "scale=854:480:flags=lanczos,format=yuv420p" -c:v libx264 -profile:v high -preset slow -crf 29 \
  -af "$AF" -c:a aac -b:a 96k -ar 44100 -movflags +faststart video/studio-lite.mp4
if [ -n "$1" ]; then
  ffmpeg -y -i "$1" -vf "format=yuv420p" -c:v libx264 -profile:v high -preset slow -crf 27 -r 24 \
    -af "$AF" -c:a aac -b:a 112k -ar 44100 -movflags +faststart video/intro.mp4
fi
