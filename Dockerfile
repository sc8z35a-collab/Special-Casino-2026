# BLOCKBUSTER REELS on your own server (the free option is Cloudflare, see README.md):
# the game files and the API in one small image.
#   docker build -t blockbuster-reels .
#   docker run -p 8080:8080 -v blockbuster-data:/data blockbuster-reels
FROM node:22-alpine

WORKDIR /app
# the game files, the server and (once built) download/ with the Android app;
# .dockerignore keeps the rest out, the server only serves the game files
COPY . ./
COPY deploy/entrypoint.sh /usr/local/bin/entrypoint
RUN chmod 755 /usr/local/bin/entrypoint

# node:sqlite still prints an "experimental" notice on Node 22
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data NODE_OPTIONS=--disable-warning=ExperimentalWarning
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1

ENTRYPOINT ["entrypoint"]
CMD ["node", "server/node/server.js"]
