# syntax=docker/dockerfile:1.6
# Build context MUST be the monorepo root.
# render.yaml sets: dockerContext: . / dockerfilePath: ./services/api/Dockerfile

FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /repo

COPY package.json package-lock.json turbo.json ./
COPY services/api/package.json services/api/
COPY services/ai-orchestrator/package.json services/ai-orchestrator/
COPY services/worker/package.json services/worker/
COPY apps/mobile/package.json apps/mobile/
COPY packages/ai-prompts/package.json packages/ai-prompts/
COPY packages/mobile-shared/package.json packages/mobile-shared/
COPY packages/ui-components/package.json packages/ui-components/

RUN npm ci --legacy-peer-deps --no-audit --no-fund

FROM deps AS builder
WORKDIR /repo
COPY tsconfig.json ./
COPY packages ./packages
COPY services/api ./services/api
RUN npx turbo run build --filter=@leeloo/api...
# Merge service-level node_modules that npm workspaces didn't hoist into root
RUN if [ -d /repo/services/api/node_modules ]; then \
      cp -rn /repo/services/api/node_modules/. /repo/node_modules/ 2>/dev/null || true; \
    fi

FROM node:20-alpine AS runner
RUN apk add --no-cache curl tini
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder --chown=node:node /repo/node_modules ./node_modules
COPY --from=builder --chown=node:node /repo/packages ./packages
COPY --from=builder --chown=node:node /repo/services/api/dist ./dist
COPY --from=builder --chown=node:node /repo/services/api/package.json ./package.json

EXPOSE 3000
ENV PORT=3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:${PORT}/v1/health || exit 1

USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
