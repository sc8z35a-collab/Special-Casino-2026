#!/bin/sh
# Start screen video: crop the 2560x1440 recording to the game's 2000x924
# stage and encode it twice without its (silent) sound track (full size for the server, a small one that is
# embedded in the single-file build). Needs ffmpeg.
#   sh tools/video/encode_title.sh
set -e
cd "$(dirname "$0")/../.."
SRC=tools/video/source/title-source.mp4
VF="crop=2560:1182:0:128,scale=%s:flags=lanczos,format=yuv420p"
ffmpeg -y -i "$SRC" -vf "$(printf "$VF" 2000:924)" -c:v libx264 -profile:v high -preset slow -crf 24 \
  -an -movflags +faststart video/title.mp4
ffmpeg -y -i "$SRC" -vf "$(printf "$VF" 1280:592)" -c:v libx264 -profile:v high -preset slow -crf 29 \
  -an -movflags +faststart video/title-lite.mp4
