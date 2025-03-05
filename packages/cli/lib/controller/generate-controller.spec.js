"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importDefault(require("fs"));
const os_1 = tslib_1.__importDefault(require("os"));
const path_1 = tslib_1.__importDefault(require("path"));
const common_1 = require("@subql/common");
const common_ethereum_1 = require("@subql/common-ethereum");
const types_ethereum_1 = require("@subql/types-ethereum");
const constants_1 = require("../constants");
const modulars_1 = require("../modulars");
const utils_1 = require("../utils");
const generate_controller_1 = require("./generate-controller");
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
const mockDsFn = () => [
    {
        kind: types_ethereum_1.EthereumDatasourceKind.Runtime,
        startBlock: 1,
        options: {
            abi: 'Erc721',
            address: '',
        },
        assets: {
            erc721: { file: 'erc721.json' },
        },
        mapping: {
            file: '',
            handlers: [
                {
                    handler: 'handleTransaction',
                    kind: types_ethereum_1.EthereumHandlerKind.Call,
                    filter: {
                        function: 'approve(address,uint256)',
                    },
                },
                {
                    handler: 'handleLog',
                    kind: types_ethereum_1.EthereumHandlerKind.Event,
                    filter: {
                        topics: ['Transfer(address,address,uint256)'],
                    },
                },
            ],
        },
    },
];
const mockDsStr = '' +
    '[\n' +
    '{\n' +
    "                kind: 'EthereumDatasourceKind.Runtime',\n" +
    '                startBlock: 4719568,\n' +
    '    \n' +
    '                options: {\n' +
    '                    // Must be a key of assets\n' +
    "                    abi:'erc20',\n" +
    '                    // # this is the contract address for wrapped ether https://etherscan.io/address/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2\n' +
    "                    address:'0x60781C2586D68229fde47564546784ab3fACA982'\n" +
    '                },\n' +
    "                assets: \"new Map([['erc20', { file: './abis/erc20.abi.json' }]])\",\n" +
    '                mapping: {\n' +
    '                    file: "./dist/index.js",\n' +
    '                    handlers: [\n' +
    '                        {\n' +
    "                            kind: 'EthereumHandlerKind.Call',\n" +
    '                            handler: "handleTransaction",\n' +
    '                            filter: {\n' +
    '                                function: "approve(address,uint256)",\n' +
    '                            },\n' +
    '                        },\n' +
    '                        {\n' +
    "                            kind: 'EthereumHandlerKind.Event',\n" +
    '                            handler: "handleLog",\n' +
    '                            filter: {\n' +
    '                                topics: ["Transfer(address,address,uint256)"],\n' +
    '                            },\n' +
    '                        },\n' +
    '                    ],\n' +
    '                },\n' +
    '            },\n' +
    '        ]';
describe('CLI codegen:generate', () => {
    const projectPath = path_1.default.join(__dirname, '../../test/schemaTest');
    const abiInterface = (0, common_ethereum_1.getAbiInterface)(projectPath, './erc721.json');
    const ethModule = (0, modulars_1.loadDependency)(common_1.NETWORK_FAMILY.ethereum);
    const abiName = ethModule.parseContractPath('./erc721.json').name;
    const eventFragments = abiInterface.events;
    const functionFragments = (0, generate_controller_1.filterObjectsByStateMutability)(abiInterface.functions);
    it('Construct correct datasources', () => {
        const mockUserInput = {
            startBlock: 1,
            functions: mockConstructedFunctions,
            events: mockConstructedEvents,
            abiPath: './abis/erc721.json',
            address: 'aaa',
        };
        const constructedDs = (0, generate_controller_1.constructDatasourcesYaml)(mockUserInput);
        const expectedAsset = new Map();
        expectedAsset.set('Erc721', { file: './abis/erc721.json' });
        expect(constructedDs).toStrictEqual({
            kind: types_ethereum_1.EthereumDatasourceKind.Runtime,
            startBlock: 1,
            options: {
                abi: 'Erc721',
                address: 'aaa',
            },
            assets: expectedAsset,
            mapping: {
                file: './dist/index.js',
                handlers: [
                    {
                        handler: 'handleTransferFromErc721Tx',
                        kind: types_ethereum_1.EthereumHandlerKind.Call,
                        filter: {
                            function: 'transferFrom(address,address,uint256)',
                        },
                    },
                    {
                        handler: 'handleApprovalErc721Log',
                        kind: types_ethereum_1.EthereumHandlerKind.Event,
                        filter: {
                            topics: ['Approval(address,address,uint256)'],
                        },
                    },
                ],
            },
        });
    });
    it('prepareInputFragments, should return all fragments, if user passes --events="*"', async () => {
        const result = await (0, generate_controller_1.prepareInputFragments)('event', '*', eventFragments, abiName);
        expect(result).toStrictEqual(abiInterface.events);
    });
    it('prepareInputFragments, no method passed, should prompt through inquirer', async () => {
        // when using ejs, jest spyOn does not work on inquirer
        const inquirer = require('@inquirer/prompts');
        const promptSpy = jest.spyOn(inquirer, 'checkbox').mockResolvedValue(['Approval(address,address,uint256)']);
        const emptyStringPassed = await (0, generate_controller_1.prepareInputFragments)('event', '', eventFragments, abiName);
        expect(promptSpy).toHaveBeenCalledTimes(1);
        const undefinedPassed = await (0, generate_controller_1.prepareInputFragments)('event', undefined, eventFragments, abiName);
        expect(emptyStringPassed).toStrictEqual(undefinedPassed);
    });
    it('prepareInputFragments, --functions="transferFrom", should return matching fragment method (cased insensitive)', async () => {
        const result = await (0, generate_controller_1.prepareInputFragments)('function', 'transferFrom', functionFragments, abiName);
        const insensitiveInputResult = await (0, generate_controller_1.prepareInputFragments)('function', 'transFerfrom', functionFragments, abiName);
        expect(result).toStrictEqual(insensitiveInputResult);
        expect(result).toStrictEqual({
            'transferFrom(address,address,uint256)': abiInterface.functions['transferFrom(address,address,uint256)'],
        });
    });
    it('should throw when passing invalid methods', async () => {
        await expect((0, generate_controller_1.prepareInputFragments)('function', 'transFerfrom(address,address,uint256)', functionFragments, abiName)).rejects.toThrow("'transFerfrom(address' is not a valid function on Erc721");
        await expect((0, generate_controller_1.prepareInputFragments)('function', 'transferFrom(address from, address to, uint256 tokenid)', functionFragments, abiName)).rejects.toThrow("'transferFrom(address from' is not a valid function on Erc721");
        await expect((0, generate_controller_1.prepareInputFragments)('function', 'asdfghj', functionFragments, abiName)).rejects.toThrow("'asdfghj' is not a valid function on Erc721");
    });
    it('Ensure generateHandlerName', () => {
        expect((0, generate_controller_1.generateHandlerName)('transfer', 'erc721', 'log')).toBe('handleTransferErc721Log');
    });
    it('Ensure ConstructHandlerProps', () => {
        const functionMethods = [{ name: 'transfer', method: 'transfer(address,uint256)' }];
        const eventsMethods = [{ name: 'Approval', method: 'Approval(address,address,uint256)' }];
        const result = (0, generate_controller_1.constructHandlerProps)([eventsMethods, functionMethods], abiName);
        expect(result).toStrictEqual({
            name: 'Erc721',
            handlers: [
                {
                    name: 'handleTransferErc721Tx',
                    argName: 'tx',
                    argType: 'TransferTransaction',
                },
                { name: 'handleApprovalErc721Log', argName: 'log', argType: 'ApprovalLog' },
            ],
        });
    });
    it('FilterObjectsByStatMutability', () => {
        const mockData = {
            'transfer(address,uint256)': {
                type: 'function',
                name: 'transfer',
                constant: false,
                inputs: [[], []],
                outputs: [[]],
                payable: false,
                stateMutability: 'nonpayable',
                gas: null,
                _isFragment: true,
            },
            'allowance(address,address)': {
                type: 'function',
                name: 'allowance',
                constant: true,
                inputs: [[], []],
                outputs: [[]],
                payable: false,
                stateMutability: 'view',
                gas: null,
                _isFragment: true,
            },
        };
        const filteredResult = (0, generate_controller_1.filterObjectsByStateMutability)(mockData);
        expect(filteredResult).toEqual({
            'transfer(address,uint256)': {
                type: 'function',
                name: 'transfer',
                constant: false,
                inputs: [[], []],
                outputs: [[]],
                payable: false,
                stateMutability: 'nonpayable',
                gas: null,
                _isFragment: true,
            },
        });
    });
    it('filter out existing methods, input address === undefined && ds address === "", should filter', () => {
        const ds = mockDsFn();
        ds[0].options.address = '';
        const [cleanEvents, cleanFunctions] = (0, generate_controller_1.filterExistingMethods)(eventFragments, functionFragments, ds, undefined, generate_controller_1.yamlExtractor);
        // function approve should be filtered out
        // event transfer should be filtered out
        expect(cleanEvents).toStrictEqual({
            'Approval(address,address,uint256)': eventFragments['Approval(address,address,uint256)'],
            'ApprovalForAll(address,address,bool)': eventFragments['ApprovalForAll(address,address,bool)'],
        });
        expect(cleanEvents['Transfer(address,address,uint256)']).toBeFalsy();
        expect(cleanFunctions['approve(address,uint256)']).toBeFalsy();
    });
    it('filter out existing methods, only on matching address', () => {
        const ds = mockDsFn();
        ds[0].options.address = '0x892476D79090Fa77C6B9b79F68d21f62b46bEDd2';
        const [cleanEvents, cleanFunctions] = (0, generate_controller_1.filterExistingMethods)(eventFragments, functionFragments, ds, 'zzz', generate_controller_1.yamlExtractor);
        const constructedEvents = (0, generate_controller_1.constructMethod)(cleanEvents);
        const constructedFunctions = (0, generate_controller_1.constructMethod)(cleanFunctions);
        console.log(constructedEvents, '|', constructedFunctions);
        // expect(constructedEvents.length).toBe(Object.keys(eventFragments).length);
        // expect(constructedFunctions.length).toBe(Object.keys(functionFragments).length);
    });
    it('filter out existing methods, inputAddress === undefined || "" should filter all ds that contains no address', () => {
        const ds = mockDsFn();
        if (ds[0].options?.address)
            ds[0].options.address = undefined;
        const [cleanEvents, cleanFunctions] = (0, generate_controller_1.filterExistingMethods)(eventFragments, functionFragments, ds, undefined, generate_controller_1.yamlExtractor);
        expect(cleanEvents).toStrictEqual({
            'Approval(address,address,uint256)': eventFragments['Approval(address,address,uint256)'],
            'ApprovalForAll(address,address,bool)': eventFragments['ApprovalForAll(address,address,bool)'],
        });
        expect(cleanEvents['Transfer(address,address,uint256)']).toBeFalsy();
        expect(cleanFunctions['approve(address,uint256)']).toBeFalsy();
    });
    it('filter out different formatted filters', () => {
        const ds = mockDsFn();
        ds[0].options.address = 'zzz';
        const logHandler = ds[0].mapping.handlers[1].filter;
        const txHandler = ds[0].mapping.handlers[0].filter;
        txHandler.function = 'approve(address to, uint256 tokenId)';
        logHandler.topics = ['Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'];
        // should filter out approve and Transfer
        const [cleanEvents, cleanFunctions] = (0, generate_controller_1.filterExistingMethods)(eventFragments, functionFragments, ds, 'zzz', generate_controller_1.yamlExtractor);
        const constructedEvents = (0, generate_controller_1.constructMethod)(cleanEvents);
        const constructedFunctions = (0, generate_controller_1.constructMethod)(cleanFunctions);
        expect(constructedEvents).toStrictEqual([
            { name: 'Approval', method: 'Approval(address,address,uint256)' },
            {
                name: 'ApprovalForAll',
                method: 'ApprovalForAll(address,address,bool)',
            },
        ]);
        expect(constructedFunctions).toStrictEqual([
            {
                name: 'safeTransferFrom',
                method: 'safeTransferFrom(address,address,uint256)',
            },
            {
                name: 'safeTransferFrom',
                method: 'safeTransferFrom(address,address,uint256,bytes)',
            },
            {
                name: 'setApprovalForAll',
                method: 'setApprovalForAll(address,bool)',
            },
            {
                name: 'transferFrom',
                method: 'transferFrom(address,address,uint256)',
            },
        ]);
    });
    it('removeKeyword, should only remove expect value', () => {
        let inputString = 'event ApprovalForAll(address indexed _owner, address indexed _operator, bool _approved)';
        expect((0, generate_controller_1.removeKeyword)(inputString)).toBe('ApprovalForAll(address indexed _owner, address indexed _operator, bool _approved)');
        inputString = 'function balanceOf(address _owner) external view returns (uint256)';
        expect((0, generate_controller_1.removeKeyword)(inputString)).toBe('balanceOf(address _owner) external view returns (uint256)');
        inputString = 'balanceOf(address _owner) external view returns (uint256)';
        expect((0, generate_controller_1.removeKeyword)(inputString)).toBe('balanceOf(address _owner) external view returns (uint256)');
    });
    it('Able to read from artifacts and abis', () => {
        const mockPath_1 = path_1.default.join(__dirname, '../../test/abiTest1/');
        const mockPath_2 = path_1.default.join(__dirname, '../../test/abiTest2/');
        expect((0, common_ethereum_1.getAbiInterface)(mockPath_1, 'abis.json')).toBeTruthy();
        expect((0, common_ethereum_1.getAbiInterface)(mockPath_1, 'artifact.json')).toBeTruthy();
        expect(() => (0, common_ethereum_1.getAbiInterface)(mockPath_2, 'artifact.json')).toThrow('Provided ABI is not a valid ABI or Artifact');
    });
    it('resolve to absolutePath from tilde', () => {
        const tildePath = '~/Downloads/example.file';
        expect((0, utils_1.resolveToAbsolutePath)(tildePath)).toBe(`${os_1.default.homedir()}/Downloads/example.file`);
    });
    it('resolve to absolutePath from relativePath', () => {
        const abiPath_relative = './packages/cli/test/abiTest1/abis/abis.json';
        expect((0, utils_1.resolveToAbsolutePath)(abiPath_relative)).toBe(path_1.default.join(__dirname, '../../test/abiTest1/abis/abis.json'));
    });
    it('if absolutePath regex should not do anything', () => {
        const absolutePath = '/root/Downloads/example.file';
        expect((0, utils_1.resolveToAbsolutePath)(absolutePath)).toBe(absolutePath);
    });
    it('filter existing methods', () => {
        const casedInputAddress = '0x60781C2586D68229fde47564546784ab3fACA982'.toLowerCase();
        const [cleanEvents, cleanFunctions] = (0, generate_controller_1.filterExistingMethods)(eventFragments, functionFragments, mockDsStr, casedInputAddress, generate_controller_1.tsExtractor);
        // should filter out approve fn and transfer event
        expect(Object.keys(cleanEvents).includes('Transfer')).toBe(false);
        expect(Object.keys(cleanFunctions).includes('approval')).toBe(false);
    });
    it('splitArrayString', () => {
        const dsArr = '' +
            '[\n' +
            '{\n' +
            "                kind: 'EthereumDatasourceKind.Runtime',\n" +
            '                startBlock: 4719568,\n' +
            '    \n' +
            '                options: {\n' +
            '                    // Must be a key of assets\n' +
            "                    abi:'erc20',\n" +
            '                    // # this is the contract address for wrapped ether https://etherscan.io/address/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2\n' +
            "                    address:'0x60781C2586D68229fde47564546784ab3fACA982'\n" +
            '                },\n' +
            "                assets: \"new Map([['erc20', { file: './abis/erc20.abi.json' }]])\",\n" +
            '                mapping: {\n' +
            '                    file: "./dist/index.js",\n' +
            '                    handlers: [\n' +
            '                        {\n' +
            "                            kind: 'EthereumHandlerKind.Call',\n" +
            '                            handler: "handleTransaction",\n' +
            '                            filter: {\n' +
            '                                function: "approve(address,uint256)",\n' +
            '                            },\n' +
            '                        },\n' +
            '                        {\n' +
            "                            kind: 'EthereumHandlerKind.Event',\n" +
            '                            handler: "handleLog",\n' +
            '                            filter: {\n' +
            '                                topics: ["Transfer(address,address,uint256)"],\n' +
            '                            },\n' +
            '                        },\n' +
            '                    ],\n' +
            '                },\n' +
            '            },\n' +
            '{\n' +
            "                kind: 'EthereumDatasourceKind.Runtime',\n" +
            '                startBlock: 4719568,\n' +
            '    \n' +
            '                options: {\n' +
            '                    // Must be a key of assets\n' +
            "                    abi:'erc20',\n" +
            '                    // # this is the contract address for wrapped ether https://etherscan.io/address/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2\n' +
            "                    address:'0x60781C2586D68229fde47564546784ab3fACA982'\n" +
            '                },\n' +
            "                assets: \"new Map([['erc20', { file: './abis/erc20.abi.json' }]])\",\n" +
            '                mapping: {\n' +
            '                    file: "./dist/index.js",\n' +
            '                    handlers: [\n' +
            '                        {\n' +
            "                            kind: 'EthereumHandlerKind.Call',\n" +
            '                            handler: "handleTransaction",\n' +
            '                            filter: {\n' +
            '                                function: "approve(address,uint256)",\n' +
            '                            },\n' +
            '                        },\n' +
            '                        {\n' +
            "                            kind: 'EthereumHandlerKind.Event',\n" +
            '                            handler: "handleLog",\n' +
            '                            filter: {\n' +
            '                                topics: ["Transfer(address,address,uint256)"],\n' +
            '                            },\n' +
            '                        },\n' +
            '                    ],\n' +
            '                },\n' +
            '            },\n' +
            '        ]';
        expect((0, utils_1.splitArrayString)(dsArr).length).toBe(2);
    });
    it('Correct constructedDataSourcesTs', () => {
        const mockUserInput = {
            startBlock: 1,
            functions: mockConstructedFunctions,
            events: mockConstructedEvents,
            abiPath: './abis/erc721.json',
            address: 'aaa',
        };
        expect((0, generate_controller_1.constructDatasourcesTs)(mockUserInput)).toStrictEqual(`{
    kind: EthereumDatasourceKind.Runtime,
    startBlock: 1,
    options: {
      abi: 'Erc721',
      address: 'aaa',
    },
    assets: new Map([['Erc721', {file: './abis/erc721.json'}]]),
    mapping: {
      file: './dist/index.js',
      handlers: [
  {
    handler: "handleTransferFromErc721Tx",
    kind: EthereumHandlerKind.Call,
    filter: {
      function: "transferFrom(address,address,uint256)"
    }
  },
  {
    handler: "handleApprovalErc721Log",
    kind: EthereumHandlerKind.Event,
    filter: {
      topics: [
        "Approval(address,address,uint256)"
      ]
    }
  }
]
    }
  }`);
    });
    it('Construct correct ds for yaml', () => {
        const mockUserInput = {
            startBlock: 1,
            functions: mockConstructedFunctions,
            events: mockConstructedEvents,
            abiPath: './abis/erc721.json',
            address: 'aaa',
        };
        expect((0, generate_controller_1.constructDatasourcesYaml)(mockUserInput)).toStrictEqual({
            kind: types_ethereum_1.EthereumDatasourceKind.Runtime,
            startBlock: 1,
            options: {
                abi: 'Erc721',
                address: 'aaa',
            },
            assets: new Map([['Erc721', { file: './abis/erc721.json' }]]),
            mapping: {
                file: './dist/index.js',
                handlers: [
                    {
                        handler: 'handleTransferFromErc721Tx',
                        kind: types_ethereum_1.EthereumHandlerKind.Call,
                        filter: {
                            function: 'transferFrom(address,address,uint256)',
                        },
                    },
                    {
                        handler: 'handleApprovalErc721Log',
                        kind: types_ethereum_1.EthereumHandlerKind.Event,
                        filter: {
                            topics: ['Approval(address,address,uint256)'],
                        },
                    },
                ],
            },
        });
    });
    it('tsExtractor should extract existing events and functions from ts-manifest', () => {
        // TODO: extractor fails when encountering comments
        expect((0, generate_controller_1.tsExtractor)(mockDsStr, '0x60781C2586D68229fde47564546784ab3fACA982'.toLowerCase())).toStrictEqual({
            existingEvents: ['Transfer(address,address,uint256)'],
            existingFunctions: ['approve(address,uint256)'],
        });
        expect((0, generate_controller_1.tsExtractor)(mockDsStr, 'zzz'.toLowerCase())).toStrictEqual({
            existingEvents: [],
            existingFunctions: [],
        });
    });
    it('findArray indices', async () => {
        // locate dataSources
        const projectPath = path_1.default.join(__dirname, '../../test/ts-manifest', common_1.DEFAULT_TS_MANIFEST);
        const m = await fs_1.default.promises.readFile(projectPath, 'utf8');
        expect((0, utils_1.findMatchingIndices)(m, '[', ']', m.indexOf(`dataSources: `))).toStrictEqual([[1293, 2720]]);
        // locate handlers in DS
        expect((0, utils_1.findMatchingIndices)(mockDsStr, '[', ']', mockDsStr.indexOf('handlers: '))).toStrictEqual([[630, 1278]]);
    });
    // TODO failing test due to unable to process comments
    it.skip('extract from TS manifest', async () => {
        const projectPath = path_1.default.join(__dirname, '../../test/ts-manifest', common_1.DEFAULT_TS_MANIFEST);
        const m = await fs_1.default.promises.readFile(projectPath, 'utf8');
        const v = (0, utils_1.extractFromTs)(m, {
            dataSources: undefined,
            handlers: undefined,
            function: constants_1.FUNCTION_REG,
            topics: constants_1.TOPICS_REG,
            endpoint: constants_1.ENDPOINT_REG,
        });
        expect(v.dataSources).toMatch('[\n' +
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
            '  ]');
        expect(v.handlers).toMatch('[\n' +
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
            '        ]');
        // TODO expected to fail, due to unable to skip comments
        expect(v.function).toMatch('approve(address spender, uint256 rawAmount)');
        expect(v.topics?.[0]).toMatch('Transfer(address indexed from, address indexed to, uint256 amount)');
        expect(v.endpoint?.[0]).toMatch('https://eth.api.onfinality.io/public');
    });
    // });
    // All these test should test against mockData as well as
    it('Should replace value in tsManifetst', async () => {
        const projectPath = path_1.default.join(__dirname, '../../test/ts-manifest', common_1.DEFAULT_TS_MANIFEST);
        const m = await fs_1.default.promises.readFile(projectPath, 'utf8');
        const v = (0, utils_1.replaceArrayValueInTsManifest)(m, 'dataSources', '[{},{}]');
        const r = (0, utils_1.extractArrayValueFromTsManifest)(v, 'dataSources');
        expect(r).toStrictEqual('[{},{}]');
    });
    it('Correct output on tsStringify', () => {
        const mockDs = mockDsFn();
        const v = (0, generate_controller_1.tsStringify)(mockDs[0].mapping.handlers);
        expect(v).toBe(`[
  {
    handler: "handleTransaction",
    kind: "ethereum/TransactionHandler",
    filter: {
      function: "approve(address,uint256)"
    }
  },
  {
    handler: "handleLog",
    kind: "ethereum/LogHandler",
    filter: {
      topics: [
        "Transfer(address,address,uint256)"
      ]
    }
  }
]`);
    });
    it('Split array', () => {
        expect((0, utils_1.splitArrayString)("[{key: 'value1'},{key: 'value2'}]")).toStrictEqual(["{key: 'value1'}", "{key: 'value2'}"]);
        // trim spacing
        expect((0, utils_1.splitArrayString)("[{key: 'value1'},{key: 'value2'},  {key:      'value3'}]")).toStrictEqual([
            "{key: 'value1'}",
            "{key: 'value2'}",
            "{key: 'value3'}",
        ]);
        // nested objects
        expect((0, utils_1.splitArrayString)(`[ "{key: {key: 'value1'}}", "{key: {key: 'value1'}}"]`)).toStrictEqual([
            "{key: {key: 'value1'}}",
            "{key: {key: 'value1'}}",
        ]);
        // nested arrarys and objects
        expect((0, utils_1.splitArrayString)(`[ "{key: {key: ['value1']}}", "{key: {key: 'value1'}}",  "{key: [{key: 'value1'}, {key: 'value1'}]}"]`)).toStrictEqual([
            "{key: {key: ['value1']}}",
            "{key: {key: 'value1'}}",
            "{key: [{key: 'value1'}, {key: 'value1'}]}",
        ]);
    });
});
//# sourceMappingURL=generate-controller.spec.js.map