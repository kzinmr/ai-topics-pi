FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src ./src
RUN npm run build

FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates ripgrep fd-find \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 wiki && mkdir /data && chown wiki:wiki /data
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY requirements.lock ./
RUN python -m venv .venv && .venv/bin/pip install --no-cache-dir --require-hashes -r requirements.lock
COPY . .
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
ENV AI_TOPICS_PROFILE=/data/lucy PYTHONDONTWRITEBYTECODE=1
USER wiki
ENTRYPOINT ["/app/bin/wiki"]
CMD ["validate"]
