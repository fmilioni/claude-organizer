# Single image for the whole pnpm workspace. Each compose service runs a
# different command against it:
#   - migrate / api -> tsx (TS source + workspace deps)
#   - mcp           -> node on its tsup bundle (dist/server.mjs)
#   - web           -> node on the Nuxt/Nitro build output (.output)
# Debian (glibc), not alpine (musl): onnxruntime-node — the embedding runtime for
# semantic search (CO-241) — ships glibc-only prebuilt bindings and won't load on
# musl. Slim keeps the image lean while staying glibc.
FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile

# Browser-facing API URL is baked into the SPA at build time (ssr: false), so it
# must be set here, not at runtime. Default works for a browser on the host.
ARG NUXT_PUBLIC_API_URL=http://127.0.0.1:4400
ENV NUXT_PUBLIC_API_URL=$NUXT_PUBLIC_API_URL

RUN pnpm --filter @claude-organizer/mcp build \
  && pnpm --filter @claude-organizer/web build
