# ── Build stage ──
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
RUN npm rebuild better-sqlite3
COPY src/ ./src/
COPY scripts/ ./scripts/
RUN npm run build

# ── Runtime stage ──
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY --from=build /app/scripts ./scripts
COPY CLAUDE.md.template .env.example ./
RUN mkdir -p store workspace/uploads && chown -R node:node /app /home/node
USER node
EXPOSE 3847
ENV DASHBOARD_BIND="0.0.0.0"
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3847/ || exit 1
ENTRYPOINT ["/app/scripts/entrypoint.sh"]
