FROM node:24 AS builder
WORKDIR /app
RUN corepack enable

COPY ui/pnpm-lock.yaml ui/pnpm-workspace.yaml .
RUN pnpm fetch --frozen

COPY ui/package.json .
RUN pnpm install --offline

COPY ui/tsconfig* ui/vite* ui/shared* ui/index.html .
COPY ui/src src
COPY config/ui.json /config/
RUN pnpm build

FROM denoland/deno:2.4.3
COPY --from=builder /app/dist /var/www
RUN deno install --global --allow-net --allow-read jsr:@std/http@1/file-server
ENV PORT=8000
CMD ["file-server", "/var/www"]
