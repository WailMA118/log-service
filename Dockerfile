FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV NODE_OPTIONS="--max-old-space-size=192"

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# dist/ is self-contained after the build step (scripts/copy-migrations.mjs
# copies the .sql migration files and journal metadata into dist/db/migrations,
# since tsc only compiles .ts files and silently skips everything else).
# src/ is intentionally NOT copied into the runner stage -- it was only
# ever needed at build time.
COPY --from=builder /app/dist ./dist

EXPOSE 8080
USER node
CMD ["node", "dist/index.js"]