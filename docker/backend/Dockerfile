# Backend (Node/Express/Prisma). Build context is the REPO ROOT, not
# backend/ -- tsconfig.json's rootDir is ".." (the repo root) because it
# also compiles a handful of shared parser/validator .js files from
# assets/js/data/, so both backend/ and that slice of assets/ need to be
# in the build context.
#
# Runs via tsx directly (no separate tsc compile stage) -- this is exactly
# how the app has run all along (`npm run dev` = `tsx watch src/server.ts`),
# so this container reuses a proven execution path instead of introducing
# an untested tsc-build step.

FROM node:24-slim AS base
WORKDIR /app/backend

FROM base AS deps
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

FROM deps AS runtime
WORKDIR /app
COPY backend ./backend
COPY assets/js/data/parser.js assets/js/data/validator.js assets/js/data/branches.js ./assets/js/data/
WORKDIR /app/backend
RUN npx prisma generate

EXPOSE 4000
CMD ["npx", "tsx", "src/server.ts"]
