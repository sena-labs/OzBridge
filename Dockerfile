# syntax=docker/dockerfile:1
#
# Container image for the standalone Warp Oz MCP server
# (`@sena-labs/oz-mcp-server`). Lets Glama and other registries build, run and
# introspect the server reproducibly.
#
# The server speaks MCP over HTTP + SSE on port 3847. It binds to 127.0.0.1 by
# default so the container always starts (the security gate refuses a
# non-loopback bind without a token). To expose it to other hosts, run with:
#
#   docker run -p 3847:3847 \
#     -e OZ_MCP_BIND=0.0.0.0 \
#     -e OZ_MCP_TOKEN=<your-secret> \
#     ghcr.io/sena-labs/oz-mcp-server
#
# Note: actually launching Oz agents needs the `oz` CLI (Warp) reachable inside
# the container — mount it in or extend this image. Tool introspection
# (`tools/list`, `/health`) works without it.

# ---- builder ---------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

# Install all deps (incl. esbuild) against the committed lockfile.
COPY package.json package-lock.json ./
COPY packages/oz-mcp-server/package.json packages/oz-mcp-server/package.json
COPY packages/copilot-chat-toolkit/package.json packages/copilot-chat-toolkit/package.json
RUN npm ci

# Sources the esbuild bundle pulls in, then build a single self-contained
# CJS file (all dependencies inlined; nothing else needed at runtime).
COPY tsconfig.json ./
COPY src ./src
COPY packages ./packages
RUN npm run build:standalone:prod

# ---- runtime ---------------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Non-root for least privilege.
USER node

# Single bundled entry point produced above.
COPY --from=builder --chown=node:node /app/packages/oz-mcp-server/dist/server.js ./server.js

EXPOSE 3847

# Liveness: the server answers /health on loopback (Node 20 has global fetch).
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3847/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["node", "server.js"]

LABEL org.opencontainers.image.title="oz-mcp-server" \
      org.opencontainers.image.description="Standalone MCP server for Warp Oz agents — no VS Code required." \
      org.opencontainers.image.source="https://github.com/sena-labs/OzBridge" \
      org.opencontainers.image.licenses="MIT"
