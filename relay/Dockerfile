FROM denoland/deno:2.4.3
WORKDIR /app
COPY deno.* .
RUN deno install
COPY relay relay
COPY shared.ts .
CMD ["deno", "run", "-A", "./relay/mod.ts"]
