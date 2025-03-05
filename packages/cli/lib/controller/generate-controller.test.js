"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importDefault(require("fs"));
const path_1 = tslib_1.__importDefault(require("path"));
const common_1 = require("@subql/common");
const common_ethereum_1 = require("@subql/common-ethereum");
const rimraf_1 = require("rimraf");
const yaml_1 = require("yaml");
const generate_1 = tslib_1.__importDefault(require("../commands/codegen/generate"));
const modulars_1 = require("../modulars");
const generate_controller_1 = require("./generate-controller");
const ROOT_MAPPING_DIR = 'src/mappings';
const PROJECT_PATH = path_1.default.join(__dirname, '../../test/schemaTest');
const MANIFEST_PATH = './generate-project.yaml';
const mockConstructedFunctions = [
    {
        name: 'transferFrom',
        method: 'transferFrom(address,address,uint256)',
    },
];
const mockConstructedEvents = [
    {
        name: 'Approval',
        method: 'Approval(address,address,uint256)',
    },
];
const originalManifestData = {
    specVersion: '1.0.0',
    name: 'generate-test',
    version: '0.0.1',
    runner: {
        node: {
            name: '@subql/node-ethereum',
            version: '*',
        },
        query: {
            name: '@subql/query',
            version: '*',
        },
    },
    schema: {
        file: './schema.graphql',
    },
    network: {
        chainId: '1',
        endpoint: ['https://eth.api.onfinality.io/public'],
        dictionary: 'https://gx.api.subquery.network/sq/subquery/eth-dictionary',
    },
    dataSources: [
        {
            kind: 'ethereum/Runtime',
            startBlock: 4719568,
            options: {
                abi: 'erc721',
                address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
            },
            assets: {
                erc721: {
                    file: './erc721.json',
                },
            },
            mapping: {
                file: './dist/index.js',
                handlers: [
                    {
                        handler: 'handleTransaction',
                        kind: 'ethereum/TransactionHandler',
                        filter: {
                            function: 'approve(address spender, uint256 rawAmount)',
                        },
                    },
                    {
                        handler: 'handleLog',
                        kind: 'ethereum/LogHandler',
                        filter: {
                            topics: ['Transfer(address indexed from, address indexed to, uint256 amount)'],
                        },
                    },
                ],
            },
        },
    ],
};
const originalManifestData2 = {
    specVersion: '1.0.0',
    name: 'generate-test',
    version: '0.0.1',
    runner: {
        node: {
            name: '@subql/node-ethereum',
            version: '*',
        },
        query: {
            name: '@subql/query',
            version: '*',
        },
    },
    schema: {
        file: './schema.graphql',
    },
    network: {
        chainId: '1',
        endpoint: ['https://eth.api.onfinality.io/public'],
        dictionary: 'https://gx.api.subquery.network/sq/subquery/eth-dictionary',
    },
    dataSources: [
        {
            kind: 'ethereum/Runtime',
            startBlock: 4719568,
            options: {
                abi: 'erc721',
                address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
            },
            assets: {
                erc721: {
                    file: './erc721.json',
                },
            },
            mapping: {
                file: './dist/index.js',
                handlers: [
                    {
                        handler: 'handleTransaction',
                        kind: 'ethereum/TransactionHandler',
                        filter: {
                            function: 'approve(address,uint256)',
                        },
                    },
                    {
                        handler: 'handleLog',
                        kind: 'ethereum/LogHandler',
                        filter: {
                            topics: ['Transfer(address,address,uint256)'],
                        },
                    },
                ],
            },
        },
    ],
};
const ethModule = (0, modulars_1.loadDependency)(common_1.NETWORK_FAMILY.ethereum);
const abiName = ethModule.parseContractPath('./erc721.json').name;
const mockUserInput = {
    startBlock: 1,
    functions: mockConstructedFunctions,
    events: mockConstructedEvents,
    abiPath: './abis/erc721.json',
    address: 'aaa',
};
jest.setTimeout(30000);
describe('CLI codegen:generate, Can write to file', () => {
    afterEach(async () => {
        await Promise.all([
            (0, rimraf_1.rimraf)(path_1.default.join(__dirname, '../../test/schemaTest/src')),
            (0, rimraf_1.rimraf)(path_1.default.join(__dirname, '../../test/schemaTest/abis/abis.json')),
            (0, rimraf_1.rimraf)(path_1.default.join(__dirname, '../../test/ts-manifest/mock-project.ts')),
            fs_1.default.promises.writeFile(path_1.default.join(PROJECT_PATH, MANIFEST_PATH), (0, yaml_1.stringify)(originalManifestData), {
                encoding: 'utf8',
                flag: 'w',
            }),
        ]);
        const doc = new yaml_1.Document(originalManifestData2);
        const ds = doc.get('dataSources').items[0];
        ds.commentBefore = 'datasource comment';
        ds.get('mapping').get('handlers').comment = 'handler comment';
        await fs_1.default.promises.writeFile(path_1.default.join(PROJECT_PATH, './generate-project-2.yaml'), (0, yaml_1.stringify)(doc), {
            encoding: 'utf8',
            flag: 'w',
        });
    });
    it('generateManifest from ts-manifest', async () => {
        const pPath = path_1.default.join(__dirname, '../../test/ts-manifest');
        const filePath = path_1.default.join(pPath, 'mock-project.ts');
        const tsManifest = await fs_1.default.promises.readFile(path_1.default.join(pPath, common_1.DEFAULT_TS_MANIFEST), 'utf8');
        const mockInput = {
            startBlock: 1,
            functions: mockConstructedFunctions,
            events: mockConstructedEvents,
            abiPath: './abis/erc721.json',
            address: 'aaa',
        };
        await (0, generate_controller_1.generateManifestTs)(path_1.default.join(pPath, './mock-project.ts'), mockInput, tsManifest);
        const newManifest = await fs_1.default.promises.readFile(filePath, 'utf8');
        expect(newManifest).toBe('// @ts-nocheck\n' +
            "import {EthereumProject, EthereumDatasourceKind, EthereumHandlerKind} from '@subql/types-ethereum';\n" +
            '\n' +
            '// Can expand the Datasource processor types via the generic param\n' +
            'const project: EthereumProject = {\n' +
            "  specVersion: '1.0.0',\n" +
            "  version: '0.0.1',\n" +
            "  name: 'ethereum-subql-starter',\n" +
            "  description: 'This project can be use as a starting point for developing your new Ethereum SubQuery project',\n" +
            '  runner: {\n' +
            '    node: {\n' +
            "      name: '@subql/node-ethereum',\n" +
            "      version: '>=3.0.0',\n" +
            '    },\n' +
            '    query: {\n' +
            "      name: '@subql/query',\n" +
            "      version: '*',\n" +
            '    },\n' +
            '  },\n' +
            '  schema: {\n' +
            "    file: './schema.graphql',\n" +
            '  },\n' +
            '  network: {\n' +
            '    /**\n' +
            '     * chainId is the EVM Chain ID, for Ethereum this is 1\n' +
            '     * https://chainlist.org/chain/1\n' +
            '     */\n' +
            "    chainId: '1',\n" +
            '    /**\n' +
            '     * This endpoint must be a public non-pruned archive node\n' +
            '     * Public nodes may be rate limited, which can affect indexing speed\n' +
            '     * When developing your project we suggest getting a private API key\n' +
            '     * You can get them from OnFinality for free https://app.onfinality.io\n' +
            '     * https://documentation.onfinality.io/support/the-enhanced-api-service\n' +
            '     */\n' +
            "    endpoint: ['https://eth.api.onfinality.io/public'],\n" +
            "    dictionary: 'https://gx.api.subquery.network/sq/subquery/eth-dictionary',\n" +
            '  },\n' +
            '  dataSources: [{\n' +
            '    kind: EthereumDatasourceKind.Runtime,\n' +
            '    startBlock: 1,\n' +
            '    options: {\n' +
            "      abi: 'Erc721',\n" +
            "      address: 'aaa',\n" +
            '    },\n' +
            "    assets: new Map([['Erc721', {file: './abis/erc721.json'}]]),\n" +
            '    mapping: {\n' +
            "      file: './dist/index.js',\n" +
            '      handlers: [\n' +
            '  {\n' +
            '    handler: "handleTransferFromErc721Tx",\n' +
            '    kind: EthereumHandlerKind.Call,\n' +
            '    filter: {\n' +
            '      function: "transferFrom(address,address,uint256)"\n' +
            '    }\n' +
            '  },\n' +
            '  {\n' +
            '    handler: "handleApprovalErc721Log",\n' +
            '    kind: EthereumHandlerKind.Event,\n' +
            '    filter: {\n' +
            '      topics: [\n' +
            '        "Approval(address,address,uint256)"\n' +
            '      ]\n' +
            '    }\n' +
            '  }\n' +
            ']\n' +
            '    }\n' +
            '  },\n' +
            '    {\n' +
            '      kind: EthereumDatasourceKind.Runtime,\n' +
            '      startBlock: 4719568,\n' +
            '\n' +
            '      options: {\n' +
            '        // Must be a key of assets\n' +
            "        abi: 'erc20',\n" +
            '        // # this is the contract address for wrapped ether https://etherscan.io/address/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2\n' +
            "        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',\n" +
            '      },\n' +
            "      assets: new Map([['erc20', {file: './abis/erc20.abi.json'}]]),\n" +
            '      mapping: {\n' +
            "        file: './dist/index.js',\n" +
            '        handlers: [\n' +
            '          {\n' +
            '            kind: EthereumHandlerKind.Call,\n' +
            "            handler: 'handleTransaction',\n" +
            '            filter: {\n' +
            '              /**\n' +
            '               * The function can either be the function fragment or signature\n' +
            "               * function: '0x095ea7b3'\n" +
            "               * function: '0x7ff36ab500000000000000000000000000000000000000000000000000000000'\n" +
            '               */\n' +
            "              function: 'approve(address spender, uint256 rawAmount)',\n" +
            '            },\n' +
            '          },\n' +
            '          {\n' +
            '            kind: EthereumHandlerKind.Event,\n' +
            "            handler: 'handleLog',\n" +
            '            filter: {\n' +
            '              /**\n' +
            '               * Follows standard log filters https://docs.ethers.io/v5/concepts/events/\n' +
            '               * address: "0x60781C2586D68229fde47564546784ab3fACA982"\n' +
            '               */\n' +
            "              topics: ['Transfer(address indexed from, address indexed to, uint256 amount)'],\n" +
            '            },\n' +
            '          },\n' +
            '        ],\n' +
            '      },\n' +
            '    },\n' +
            '  ],\n' +
            "  repository: 'https://github.com/subquery/ethereum-subql-starter',\n" +
            '};\n' +
            '\n' +
            'export default project;\n');
    });
    it('Can generate manifest', async () => {
        const existingManifestData = await (0, generate_controller_1.getManifestData)(path_1.default.join(PROJECT_PATH, MANIFEST_PATH));
        await (0, generate_controller_1.generateManifestYaml)(path_1.default.join(PROJECT_PATH, MANIFEST_PATH), mockUserInput, existingManifestData);
        const updatedManifestDs = (0, common_1.loadFromJsonOrYaml)(path_1.default.join(PROJECT_PATH, MANIFEST_PATH)).dataSources;
        expect(updatedManifestDs[1]).toStrictEqual({
            kind: 'ethereum/Runtime',
            startBlock: mockUserInput.startBlock,
            options: {
                abi: 'Erc721',
                address: mockUserInput.address,
            },
            assets: {
                Erc721: {
                    file: mockUserInput.abiPath,
                },
            },
            mapping: {
                file: './dist/index.js',
                handlers: [
                    {
                        filter: {
                            function: mockUserInput.functions[0].method,
                        },
                        handler: `${(0, generate_controller_1.generateHandlerName)(mockUserInput.functions[0].name, abiName, 'tx')}`,
                        kind: 'ethereum/TransactionHandler',
                    },
                    {
                        filter: {
                            topics: [mockUserInput.events[0].method],
                        },
                        handler: `${(0, generate_controller_1.generateHandlerName)(mockUserInput.events[0].name, abiName, 'log')}`,
                        kind: 'ethereum/LogHandler',
                    },
                ],
            },
        });
    });
    it('if handler filter already exist with matching address, should not add', async () => {
        const existingManifestData = await (0, generate_controller_1.getManifestData)(path_1.default.join(PROJECT_PATH, './generate-project-2.yaml'));
        const abiInterface = (0, common_ethereum_1.getAbiInterface)(PROJECT_PATH, './erc721.json');
        const existingDs = existingManifestData.get('dataSources').toJSON();
        const rawEventFragments = abiInterface.events;
        const rawFunctionFragments = (0, generate_controller_1.filterObjectsByStateMutability)(abiInterface.functions);
        const selectedEvents = await (0, generate_controller_1.prepareInputFragments)('event', 'approval, transfer', rawEventFragments, abiName);
        const selectedFunctions = await (0, generate_controller_1.prepareInputFragments)('function', 'approve, transferFrom', rawFunctionFragments, abiName);
        const [eventFrags, functionFrags] = (0, generate_controller_1.filterExistingMethods)(selectedEvents, selectedFunctions, existingDs, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', generate_controller_1.yamlExtractor);
        mockUserInput.events = (0, generate_controller_1.constructMethod)(eventFrags);
        mockUserInput.functions = (0, generate_controller_1.constructMethod)(functionFrags);
        await (0, generate_controller_1.generateManifestYaml)(path_1.default.join(PROJECT_PATH, './generate-project-2.yaml'), mockUserInput, existingManifestData);
        const updatedManifestDs = (0, common_1.loadFromJsonOrYaml)(path_1.default.join(PROJECT_PATH, './generate-project-2.yaml'))
            .dataSources;
        const handlers = updatedManifestDs.map((e) => {
            return e.mapping.handlers;
        });
        expect(handlers[1]).toStrictEqual([
            {
                handler: 'handleTransferFromErc721Tx',
                kind: 'ethereum/TransactionHandler',
                filter: {
                    function: 'transferFrom(address,address,uint256)',
                },
            },
            {
                handler: 'handleApprovalErc721Log',
                kind: 'ethereum/LogHandler',
                filter: {
                    topics: ['Approval(address,address,uint256)'],
                },
            },
        ]);
    });
    it('should preserve any comments in existing datasources', async () => {
        await fs_1.default.promises.mkdir(path_1.default.join(PROJECT_PATH, 'src/'));
        await fs_1.default.promises.mkdir(path_1.default.join(PROJECT_PATH, ROOT_MAPPING_DIR));
        await fs_1.default.promises.writeFile(path_1.default.join(PROJECT_PATH, 'src/index.ts'), 'export * from "./mappings/mappingHandlers"');
        await generate_1.default.run([
            '-f',
            path_1.default.join(PROJECT_PATH, './generate-project-2.yaml'),
            '--events',
            'approval, transfer',
            '--functions',
            'transferFrom, approve',
            '--abiPath',
            './erc721.json',
            '--startBlock',
            '1',
        ]);
        const manifest = await (0, generate_controller_1.getManifestData)(path_1.default.join(PROJECT_PATH, './generate-project-2.yaml'));
        const ds = manifest.get('dataSources');
        expect(ds.commentBefore).toBe('datasource comment');
        expect(ds.items[0].get('mapping').get('handlers').comment).toBe('handler comment');
    });
    it('should throw, if handler file exists', async () => {
        await fs_1.default.promises.mkdir(path_1.default.join(PROJECT_PATH, 'src/'));
        await fs_1.default.promises.mkdir(path_1.default.join(PROJECT_PATH, ROOT_MAPPING_DIR));
        await fs_1.default.promises.writeFile(path_1.default.join(PROJECT_PATH, 'src/mappings/Erc721Handlers.ts'), 'zzzzzz');
        await expect(generate_1.default.run([
            '-f',
            path_1.default.join(PROJECT_PATH, './generate-project-2.yaml'),
            '--events',
            'approval, transfer',
            '--functions',
            'transferFrom, approve',
            '--abiPath',
            './erc721.json',
            '--startBlock',
            '1',
        ])).rejects.toThrow('file: Erc721Handlers.ts already exists');
    });
    it('Can generate mapping handlers', async () => {
        // Prepare directory
        await fs_1.default.promises.mkdir(path_1.default.join(PROJECT_PATH, 'src/'));
        await fs_1.default.promises.mkdir(path_1.default.join(PROJECT_PATH, ROOT_MAPPING_DIR));
        await fs_1.default.promises.writeFile(path_1.default.join(PROJECT_PATH, 'src/index.ts'), 'export * from "./mappings/mappingHandlers"');
        // should not overwrite existing data in index.ts
        await (0, generate_controller_1.generateHandlers)([mockConstructedEvents, mockConstructedFunctions], PROJECT_PATH, abiName);
        const expectedFnHandler = `${(0, generate_controller_1.generateHandlerName)(mockUserInput.functions[0].name, abiName, 'tx')}`;
        const expectedEventHandler = `${(0, generate_controller_1.generateHandlerName)(mockUserInput.events[0].name, abiName, 'log')}`;
        const codegenResult = await fs_1.default.promises.readFile(path_1.default.join(PROJECT_PATH, ROOT_MAPPING_DIR, `${abiName}Handlers.ts`));
        const importFile = await fs_1.default.promises.readFile(path_1.default.join(PROJECT_PATH, '/src', 'index.ts'));
        const expectImportFile = '' +
            `export * from "./mappings/mappingHandlers"
export * from "./mappings/Erc721Handlers"`;
        const expectedGeneratedCode = '' +
            `// SPDX-License-Identifier: Apache-2.0

// Auto-generated

import {TransferFromTransaction,ApprovalLog,} from "../types/abi-interfaces/Erc721";


export async function ${expectedFnHandler}(tx: TransferFromTransaction ): Promise<void> {
// Place your code logic here
}

export async function ${expectedEventHandler}(log: ApprovalLog ): Promise<void> {
// Place your code logic here
}
`;
        expect(importFile.toString()).toBe(expectImportFile);
        expect(codegenResult.toString()).toBe(expectedGeneratedCode);
    });
    it('Throws if invalid abiPath is given', async () => {
        await expect((0, generate_controller_1.prepareAbiDirectory)('asd/asd.json', PROJECT_PATH)).rejects.toThrow('Unable to find abi at: asd/asd.json');
    });
    it('Should be able to parse relative path on abiPath', async () => {
        const abiPath_relative = './packages/cli/test/abiTest1/abis/abis.json';
        await (0, generate_controller_1.prepareAbiDirectory)(abiPath_relative, PROJECT_PATH);
        expect(fs_1.default.existsSync(path_1.default.join(PROJECT_PATH, 'abis/abis.json'))).toBeTruthy();
    });
    it('Should be able to parse absolute path on abiPath', async () => {
        const abiPath_absolute = path_1.default.join(__dirname, '../../test/abiTest1/abis/abis.json');
        await (0, generate_controller_1.prepareAbiDirectory)(abiPath_absolute, PROJECT_PATH);
        expect(fs_1.default.existsSync(path_1.default.join(PROJECT_PATH, 'abis/abis.json'))).toBeTruthy();
    });
});
//# sourceMappingURL=generate-controller.test.js.map