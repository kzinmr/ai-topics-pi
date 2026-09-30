FROM node:24-bookworm-slim AS node
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 wiki && mkdir /data && chown wiki:wiki /data
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY requirements.lock ./
RUN python -m venv .venv && .venv/bin/pip install --no-cache-dir --require-hashes -r requirements.lock
COPY --from=node /build/node_modules ./node_modules
COPY . .
ENV AI_TOPICS_PROFILE=/data/lucy PYTHONDONTWRITEBYTECODE=1
USER wiki
ENTRYPOINT ["/app/bin/wiki"]
CMD ["validate"]
