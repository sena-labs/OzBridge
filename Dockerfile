# syntax=docker/dockerfile:1
#
# Container image for the standalone Warp Oz MCP server
# (`@sena-labs/oz-mcp-server`). Lets Glama and other registries build, run and
# introspect the server reproducibly.
#
# Default transport is **stdio** (the host spawns the container and talks
# JSON-RPC over stdin/stdout) — the form MCP hosts and registry sandboxes
# expect:
#
#   docker run -i --rm ghcr.io/sena-labs/oz-mcp-server
#
# To run it as an HTTP + SSE server instead, override the command (the
# ENTRYPOINT is `node server.js`, CMD supplies the args):
#
#   docker run -p 3847:3847 ghcr.io/sena-labs/oz-mcp-server \
#     --port 3847 --bind 0.0.0.0 --token <your-secret>
#
# Note: actually launching Oz agents needs the `oz` CLI (Warp) reachable inside
# the container — mount it in or extend this image. Tool introspection
# (`initialize`, `tools/list`) works without it.

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

# HTTP+SSE port, used only when the default stdio CMD is overridden.
EXPOSE 3847

# Default: speak MCP over stdio. Override CMD for HTTP+SSE (see header).
ENTRYPOINT ["node", "server.js"]
CMD ["--stdio"]

LABEL org.opencontainers.image.title="oz-mcp-server" \
      org.opencontainers.image.description="Standalone MCP server for Warp Oz agents — no VS Code required." \
      org.opencontainers.image.source="https://github.com/sena-labs/OzBridge" \
      org.opencontainers.image.licenses="MIT"
