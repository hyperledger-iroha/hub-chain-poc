import { $ } from "@david/dax";
import { faker } from "@faker-js/faker";
import * as iroha from "@iroha/core/data-model";
import { assert } from "@std/assert";
import * as fs from "@std/fs";
import * as path from "@std/path";
import * as TOML from "@std/toml";
import * as YAML from "@std/yaml";
import { JsonValue } from "npm:type-fest@^4.33.0";
import { z } from "zod";
import { RelayConfigSchema, UiConfigSchema } from "../shared.ts";

const dirname = import.meta.dirname;
assert(dirname);

const CONFIG_DIR = path.relative(Deno.cwd(), path.resolve(dirname, "../config"));
const EXECUTOR = path.resolve(dirname, "executor.wasm");

const IROHA_IMAGE = `hyperledger/iroha:experimental-xx-8c67c3eb749af3b9c468d5b601d6fd40e1d8a453`;
const CHAINS = ["aaa", "bbb", "ccc"];
const PEERS_ON_CHAIN = 4;
const ACCOUNTS_ON_CHAIN = 3;
const ASSETS = [
  iroha.AssetDefinitionId.parse("rose#wonderland"),
  iroha.AssetDefinitionId.parse(`tulip#wonderland`),
  iroha.AssetDefinitionId.parse(`time#wonderland`),
];

// =============================

const Hub = Symbol("hub-chain");
type ChainId = typeof Hub | string;

const ALL_CHAINS = [Hub, ...CHAINS] as const;

const userAccounts = new Map(CHAINS.map((chain) => {
  return [
    chain,
    Array.from({ length: ACCOUNTS_ON_CHAIN }, () => {
      // FIXME: this is not unique!
      const alias = faker.person.firstName();
      const key = iroha.KeyPair.random();
      const id = new iroha.AccountId(key.publicKey(), new iroha.DomainId("wonderland"));

      const initQuantities = ASSETS.map((asset) => ({
        id: new iroha.AssetId(id, asset),
        quantity: faker.number.int({ min: 0, max: 1500, multipleOf: 50 }),
      }));

      return { alias, key, id, initQuantities };
    }),
  ];
}));

const omnibusAccounts = new Map(CHAINS.map(chain => {
  const key = iroha.KeyPair.random();

  return [chain, {
    alias: `Omnibus Chain ${chain}`,
    id: new iroha.AccountId(key.publicKey(), new iroha.DomainId(`chain_${chain}`)),
  }];
}));

const relayAccounts = new Map(CHAINS.map((chain) => {
  const key = iroha.KeyPair.random();

  return [chain, {
    alias: `Relay ${chain}`,
    key,
    id: new iroha.AccountId(key.publicKey(), new iroha.DomainId("system")),
  }];
}));

const genesisKeys = new Map<ChainId, iroha.KeyPair>(
  ([...CHAINS, Hub] as const).map((chain) => [chain, iroha.KeyPair.random()]),
);

const peerKeys = new Map<ChainId, iroha.KeyPair[]>(
  ([...CHAINS, Hub] as const).map(
    chain => [chain, Array.from({ length: PEERS_ON_CHAIN }, () => iroha.KeyPair.random())],
  ),
);

const adminKey = iroha.KeyPair.random();
const admin = {
  key: adminKey,
  id: iroha.AccountId.parse(`${adminKey.publicKey().multihash()}@system`),
  alias: "admin",
};

const sharedConfig = {
  network: {
    address: "0.0.0.0:1337",
  },
  torii: {
    address: "0.0.0.0:8080",
  },
  logger: { format: "compact" },
};

function chainToStr(chain: ChainId): string {
  return chain === Hub ? "HUB" : chain;
}

function genesisFor(chain: ChainId) {
  const otherChains = CHAINS.filter(x => x !== chain);
  const omnibus = otherChains.map(chain => omnibusAccounts.get(chain)!);

  const omnibusTotals = otherChains.flatMap(chain =>
    userAccounts.get(chain)!.flatMap(account =>
      account.initQuantities.map((x) => ({
        id: new iroha.AssetId(omnibusAccounts.get(chain)!.id, x.id.definition),
        quantity: x.quantity,
      }))
    )
  );
  const omnibusDomains = omnibus.map(x => x.id.domain);

  let registerDomains: (string | iroha.DomainId)[];
  let registerAccounts: { id: iroha.AccountId; alias: string }[];
  let mintAssets: { id: iroha.AssetId; quantity: number | string }[];
  let transferPermissions: { account: iroha.AccountId; asset: iroha.AssetDefinitionId }[];

  if (chain !== Hub) {
    const accounts = userAccounts.get(chain)!;
    const relay = relayAccounts.get(chain)!;

    registerDomains = [
      // for assets and accounts
      "wonderland",
      // for relay & admin
      "system",
      ...omnibusDomains,
    ];
    registerAccounts = [...accounts, ...omnibus, relay, admin];
    mintAssets = [
      ...[...accounts].flatMap((account) => account.initQuantities),
      ...omnibusTotals,
    ];
    transferPermissions = ASSETS.map(asset => ({
      asset,
      account: admin.id,
    }));
  } else {
    const relays = CHAINS.map(x => relayAccounts.get(x)!);

    registerDomains = [
      ...omnibusDomains,
      // for assets
      "wonderland",
      // for relays & admin
      "system",
    ];
    registerAccounts = [...omnibus, ...relays, admin];
    mintAssets = omnibusTotals;
    transferPermissions = ASSETS.flatMap(asset =>
      relays.map(relay => ({
        asset,
        account: relay.id,
      }))
    );
  }

  const instructions = [
    ...registerDomains.map(domain => ({
      Register: {
        Domain: {
          id: domain,
          logo: null,
          metadata: {},
        },
      },
    })),

    ...registerAccounts.map((account) => ({
      Register: {
        Account: {
          id: account.id,
          metadata: { alias: account.alias },
        },
      },
    })),

    ...ASSETS.map(asset => ({
      Register: {
        AssetDefinition: {
          id: asset,
          mintable: "Infinitely",
          spec: { scale: null },
          logo: null,
          metadata: {},
        },
      },
    })),

    ...mintAssets.map(asset => ({
      Mint: {
        Asset: {
          destination: asset.id,
          object: String(asset.quantity),
        },
      },
    })),

    ...transferPermissions.map(x => ({
      Grant: {
        Permission: {
          object: {
            name: "CanTransferAssetWithDefinition",
            payload: { asset_definition: x.asset.toString() },
          },
          destination: x.account.toString(),
        },
      },
    })),
  ];

  const topology = peerKeys.get(chain)!.map(x => x.publicKey());

  return {
    chain: chainToStr(chain),
    executor: "executor.wasm",
    instructions,
    wasm_dir: "PLACEHOLDER",
    wasm_triggers: [],
    topology,
  };
}

function peerServiceId(chain: ChainId, i: number): string {
  return `chain_${chainToStr(chain)}_irohad_${i}`;
}

function chainPublicPort(chain: ChainId): number {
  return ALL_CHAINS
    .map((x, i) => ({ chain: x, port: 8080 + i }))
    .find((x) => x.chain === chain)!.port;
}

function peerComposeService(chain: ChainId, i: number) {
  const peerKey = peerKeys.get(chain)!.at(i)!;
  const genesisKey = genesisKeys.get(chain)!;

  const id = peerServiceId(chain, i);
  const trustedPeers = JSON.stringify(
    peerKeys.get(chain)!
      .map((key, j) => `${key.publicKey().multihash()}@${peerServiceId(chain, j)}:1337`)
      .filter((_val, j) => j !== i),
    null,
    2,
  );

  const environment = {
    CHAIN: chainToStr(chain),
    PUBLIC_KEY: peerKey.publicKey().multihash(),
    PRIVATE_KEY: peerKey.privateKey().multihash(),
    GENESIS_PUBLIC_KEY: genesisKey.publicKey().multihash(),
    P2P_PUBLIC_ADDRESS: `${id}:1337`,
    TRUSTED_PEERS: trustedPeers,
  };

  const isGenesis = i === 0;
  if (isGenesis) {
    Object.assign(environment, {
      GENESIS: "/tmp/genesis.signed.scale",
      GENESIS_PRIVATE_KEY: genesisKey.privateKey().multihash(),
    });
  }

  const command = isGenesis
    ? `/bin/sh -c "
  kagami genesis sign /config/chain-${chainToStr(chain)}-genesis.json \\\n\
    --public-key $GENESIS_PUBLIC_KEY \\\n\
    --private-key $GENESIS_PRIVATE_KEY \\\n\
    --out-file /tmp/genesis.signed.scale \\\n\
  && irohad --config /config/irohad.toml
"`
    : `irohad --config /config/irohad.toml`;

  const ports = i === 0 ? [`${chainPublicPort(chain)}:8080`] : [];

  return {
    [id]: {
      image: IROHA_IMAGE,
      volumes: [
        ".:/config",
      ],
      environment,
      ports,
      init: true,
      command,
      healthcheck: {
        test: "test $(curl -s http://127.0.0.1:8080/status/blocks) -gt 0",
        interval: "1s",
        timeout: "200ms",
        retries: "10",
        start_period: "2s",
      },
    },
  };
}

function peerServices() {
  return [...peerKeys]
    .flatMap(([chain, peers]) => peers.map((_key, i) => peerComposeService(chain, i)))
    .reduce((acc, obj) => ({ ...acc, ...obj }), {});
}

function relayConfigPath(chain: string) {
  return `chain-${chain}-relay.json`;
}

function relayConfig(chain: string): z.input<typeof RelayConfigSchema> {
  const account = relayAccounts.get(chain)!;

  return {
    authority: account.id.toString(),
    authorityPrivateKey: account.key.privateKey().multihash(),
    omnibusAccounts: [...omnibusAccounts.values()].map(acc => acc.id.toString()),
    domesticChainId: chain,
    domesticToriiUrl: `http://${peerServiceId(chain, 0)}:8080`,
    domesticOmnibusAccount: omnibusAccounts.get(chain)!.id.toString(),
    hubChainId: chainToStr(Hub),
    hubToriiUrl: `http://${peerServiceId(Hub, 0)}:8080`,
  };
}

function relayServices() {
  return Object.fromEntries(CHAINS.map(chain => {
    return [`chain_${chain}_relay`, {
      build: {
        context: "..",
        dockerfile: "relay/Dockerfile",
      },
      volumes: [".:/config/relay"],
      environment: {
        RELAY_CONFIG: `/config/relay/${relayConfigPath(chain)}`,
        DEBUG: "relay",
      },
      depends_on: {
        ...Object.fromEntries([
          ...peerKeys.get(chain)!.map((_x, i) => [peerServiceId(chain, i), {
            condition: "healthy",
            restart: true,
          }]),
        ]),
      },
    }];
  }));
}

function uiConfig(): z.input<typeof UiConfigSchema> {
  type ChainValue = z.input<typeof UiConfigSchema>["chains"][string];

  return {
    authority: admin.id.toString(),
    authorityPrivateKey: admin.key.privateKey().multihash(),
    transferrable: ASSETS.map(x => x.toString()),
    chains: Object.fromEntries(
      ALL_CHAINS.map<[string, ChainValue]>(
        x => {
          const toriiUrl = `http://localhost:${chainPublicPort(x)}`;
          return [
            chainToStr(x),
            x === Hub
              ? { kind: "hub", toriiUrl }
              : {
                kind: "domestic",
                toriiUrl,
                omnibus: omnibusAccounts.get(x)!.id.toString(),
                users: userAccounts.get(x)!.map(x => ({ alias: x.alias, id: x.id.toString() })),
              },
          ];
        },
      ),
    ),
  };
}

function uiService() {
  return {
    build: { context: "..", dockerfile: "ui/Dockerfile" },
    volumes: [".:/config"],
    environment: {
      UI_CONFIG: "/config/ui.json",
    },
  };
}

const dockerCompose = {
  services: {
    ...peerServices(),
    ...relayServices(),
    // TODO: not ready
    // ui: uiService(),
  },
};

async function writeConfig(file: string, content: string) {
  const full = path.join(CONFIG_DIR, file);
  $.logStep("Writing", full);
  await Deno.writeTextFile(full, content);
}

$.logStep("Emptying", CONFIG_DIR);
await fs.emptyDir(CONFIG_DIR);
await writeConfig("docker-compose.yml", YAML.stringify(dockerCompose));
await writeConfig("irohad.toml", TOML.stringify(sharedConfig));
for (const chain of ALL_CHAINS) {
  await writeConfig(`chain-${chainToStr(chain)}-genesis.json`, JSON.stringify(genesisFor(chain), null, 2));
  if (chain !== Hub) {
    await writeConfig(relayConfigPath(chain), JSON.stringify(relayConfig(chain), null, 2));
  }
}

const executorDest = path.join(CONFIG_DIR, "executor.wasm");
$.logStep("Writing", executorDest);
await Deno.copyFile(EXECUTOR, executorDest);

await writeConfig("ui.json", JSON.stringify(uiConfig(), null, 2));

$.logStep("Completed!", `Now you can run "docker-compose -f ${path.join(CONFIG_DIR, "docker-compose.yml")} up"`);
