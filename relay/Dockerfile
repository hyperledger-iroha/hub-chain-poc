FROM denoland/deno:2.4.3
WORKDIR /app
COPY relay relay
COPY deno.* .
COPY shared.ts .
RUN deno install
CMD ["deno", "run", "-A", "./relay/mod.ts"]
