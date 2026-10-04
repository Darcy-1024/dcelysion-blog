# Build this trusted dependency image outside the production 2 GB server.
# Runtime configuration requires its immutable repository@sha256 digest.
FROM node:22.23.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
ENV ASTRO_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
WORKDIR /opt/blog
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY admin/build/entrypoint.sh /opt/build-entrypoint.sh
COPY admin/build/read-input.py /opt/read-input.py
RUN chmod 0555 /opt/build-entrypoint.sh && chmod -R a+rX /opt/blog
USER 1000:1000
ENTRYPOINT ["/opt/build-entrypoint.sh"]
