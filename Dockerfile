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
RUN npm ci --omit=dev && chown -R node:node /app

COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node README.md ./

USER node

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["worker", "--bootstrap=/app/bootstrap.js"]
