FROM node:22-slim AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
COPY bootstrap.ts ./
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev \
    && useradd -u 1000 -m connector \
    && chown -R 1000:1000 /app
COPY --from=build --chown=1000:1000 /app/dist ./dist
USER 1000:1000
ENTRYPOINT ["npx", "vested-connect"]
CMD ["worker", "--bootstrap=/app/dist/bootstrap.js"]
