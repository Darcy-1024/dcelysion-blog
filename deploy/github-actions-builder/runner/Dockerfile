FROM node:24.18.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
ENV ASTRO_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
WORKDIR /opt/blog
COPY dependencies/package.json dependencies/pnpm-lock.yaml dependencies/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile && chmod -R a+rX /opt/blog
COPY runner/entrypoint.sh /opt/build-entrypoint.sh
COPY runner/read-input.py /opt/read-input.py
RUN chmod 0555 /opt/build-entrypoint.sh
USER 1000:1000
ENTRYPOINT ["/opt/build-entrypoint.sh"]
