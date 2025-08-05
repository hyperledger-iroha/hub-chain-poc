import { $ } from "@david/dax";
import { faker } from "@faker-js/faker";
import { AccountId, AssetDefinitionId, AssetId, DomainId, KeyPair } from "@iroha/core/data-model";
import { assert } from "@std/assert";
import * as fs from "@std/fs";
import * as path from "@std/path";
import * as TOML from "@std/toml";
import * as YAML from "@std/yaml";

const dirname = import.meta.dirname;
assert(dirname);

const CONFIG_DIR = path.relative(Deno.cwd(), path.resolve(dirname, "../config"));
const EXECUTOR = path.resolve(dirname, "executor.wasm");

const IROHA_IMAGE = `hyperledger/iroha:experimental-xx-8c67c3eb749af3b9c468d5b601d6fd40e1d8a453`;
const CHAINS = ["aaa", "bbb", "ccc"];
const PEERS_ON_CHAIN = 4;
const ACCOUNTS_ON_CHAIN = 3;
const ASSETS = [
  AssetDefinitionId.parse("rose#wonderland"),
  AssetDefinitionId.parse(`tulip#wonderland`),
  AssetDefinitionId.parse(`time#wonderland`),
];

// =============================

const Hub = Symbol("hub-chain");
type ChainId = typeof Hub | string;

const ALL_CHAINS = [Hub, ...CHAINS] as const;

const userAccounts = new Map(CHAINS.map((chain) => {
  return [
    chain,
    Array.from({ length: ACCOUNTS_ON_CHAIN }, () => {
      const alias = faker.person.firstName();
      const key = KeyPair.random();
      const id = new AccountId(key.publicKey(), new DomainId("wonderland"));

      const initQuantities = ASSETS.map((asset) => ({
        id: new AssetId(id, asset),
        quantity: faker.number.int({ min: 0, max: 1500, multipleOf: 50 }),
      }));

      return { alias, key, id, initQuantities };
    }),
  ];
}));

const omnibusAccounts = new Map(CHAINS.map(chain => {
  const key = KeyPair.random();

  return [chain, {
    alias: `Omnibus Chain ${chain}`,
    id: new AccountId(key.publicKey(), new DomainId(`chain_${chain}`)),
  }];
}));

const relayAccounts = new Map(CHAINS.map((chain) => {
  const key = KeyPair.random();

  return [chain, { alias: `Relay ${chain}`, key, id: new AccountId(key.publicKey(), new DomainId("system")) }];
}));

const genesisKeys = new Map<ChainId, KeyPair>(([...CHAINS, Hub] as const).map((chain) => [chain, KeyPair.random()]));

const peerKeys = new Map<ChainId, KeyPair[]>(
  ([...CHAINS, Hub] as const).map(chain => [chain, Array.from({ length: PEERS_ON_CHAIN }, () => KeyPair.random())]),
);

const sharedConfig = {
  network: {
    address: "0.0.0.0:1337",
  },
  torii: {
    address: "0.0.0.0:8080",
  },
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
        id: new AssetId(omnibusAccounts.get(chain)!.id, x.id.definition),
        quantity: x.quantity,
      }))
    )
  );
  const omnibusDomains = omnibus.map(x => x.id.domain);

  let registerDomains: (string | DomainId)[];
  let registerAccounts: { id: AccountId; alias: string }[];
  let mintAssets: { id: AssetId; quantity: number | string }[];

  if (chain !== Hub) {
    const accounts = userAccounts.get(chain)!;
    const relay = relayAccounts.get(chain)!;

    registerDomains = ["wonderland", "system", ...omnibusDomains];
    registerAccounts = [...accounts, ...omnibus, relay];
    mintAssets = [
      ...[...accounts].flatMap((account) => account.initQuantities),
      ...omnibusTotals,
    ];
  } else {
    const relays = CHAINS.map(x => relayAccounts.get(x)!);

    registerDomains = ["system", ...omnibusDomains];
    registerAccounts = [...omnibus, ...relays];
    mintAssets = omnibusTotals;
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
  ];

  const topology = peerKeys.get(chain)!.map(x => x.publicKey());

  return {
    chain: chain,
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

  // FIXME: cannot access volume configs
  const command = isGenesis
    ? `/bin/sh -c "
  kagami genesis sign /config/chain-${chainToStr(chain)}-genesis.json \
    --public-key $GENESIS_PUBLIC_KEY \
    --private-key $GENESIS_PRIVATE_KEY \
    --out-file /tmp/genesis.signed.scale \
    && irohad --config /config/iroha/irohad.toml --submit-genesis
"`
    : `irohad --config /config/irohad.toml`;

  return {
    [id]: {
      image: IROHA_IMAGE,
      volumnes: [
        ".:/config",
      ],
      environment,
      init: true,
      command,
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

function relayConfig(chain: string) {
  const account = relayAccounts.get(chain)!;

  return {
    account: account.id.toString(),
    accountPrivateKey: account.key.privateKey().multihash(),
    omnibusAccounts: [...omnibusAccounts.values()].map(acc => acc.id.toString()),
    domesticToriiUrl: `http://${peerServiceId(chain, 0)}:8080`,
    domesticOmnibusAccount: omnibusAccounts.get(chain)!.id.toString(),
    hubToriiUrl: `http://${peerServiceId(Hub, 0)}:8080`,
  };
}

function relayServices() {
  return Object.fromEntries(CHAINS.map(chain => {
    return [`chain_${chain}_relay`, {
      build: {
        context: "..",
        dockerfile: "Dockerfile.relay",
      },
      volumes: [".:/config/relay"],
      environment: {
        RELAY_CONFIG: `/config/relay/${relayConfigPath(chain)}`,
      },
    }];
  }));
}

function uiConfig() {
  return {
    accounts: [...userAccounts].flatMap(([chain, accounts]) =>
      accounts.map(account => ({
        chain,
        account: account.id,
        privateKey: account.key.privateKey(),
      }))
    ),
  };
}

function uiService() {
  return {
    build: "../Dockerfile.ui",
    environment: {
      // TODO
    },
  };
}

const dockerCompose = {
  services: {
    ...peerServices(),
    // TODO: not ready
    // ...relayServices(),
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
