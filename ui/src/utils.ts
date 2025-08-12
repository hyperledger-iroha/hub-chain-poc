import type { EventBox } from "@iroha/core/data-model";
import { match } from "ts-pattern";

function justSerialize(x: unknown): string {
  return JSON.stringify(x, (y) => {
    if (typeof y === "bigint") return String(y);
    return y;
  });
}

export function displayEvent(event: EventBox): string {
  return match(event)
    .with(
      { kind: "Pipeline" },
      ({ value }) =>
        match(value)
          .with(
            { kind: "Block" },
            ({ value }) => `Pipeline(Block(${value.header.height.value}, ${value.status.kind}))`,
          )
          .otherwise((x) => justSerialize(x)),
    )
    .otherwise(x => justSerialize(x));
}
