FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsup.config.ts ./
COPY src/ ./src/
COPY README.md ./
RUN npm run build

FROM node:22-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 && useradd -u 1000 -m connector \
 && chown -R 1000:1000 /app

COPY --from=build --chown=1000:1000 /app/dist ./dist
COPY --chown=1000:1000 README.md ./

USER 1000:1000

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["worker", "--bootstrap=/app/bootstrap.js"]
