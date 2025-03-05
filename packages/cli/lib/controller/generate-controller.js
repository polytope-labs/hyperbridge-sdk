"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.tsExtractor = exports.yamlExtractor = exports.DEFAULT_ABI_DIR = exports.DEFAULT_HANDLER_BUILD_PATH = exports.ROOT_MAPPING_DIR = void 0;
exports.removeKeyword = removeKeyword;
exports.prepareAbiDirectory = prepareAbiDirectory;
exports.constructMethod = constructMethod;
exports.promptSelectables = promptSelectables;
exports.filterObjectsByStateMutability = filterObjectsByStateMutability;
exports.getFragmentFormats = getFragmentFormats;
exports.generateHandlerName = generateHandlerName;
exports.constructDatasourcesTs = constructDatasourcesTs;
exports.constructDatasourcesYaml = constructDatasourcesYaml;
exports.prepareInputFragments = prepareInputFragments;
exports.filterExistingMethods = filterExistingMethods;
exports.getManifestData = getManifestData;
exports.prependDatasources = prependDatasources;
exports.generateManifestTs = generateManifestTs;
exports.generateManifestYaml = generateManifestYaml;
exports.constructHandlerProps = constructHandlerProps;
exports.generateHandlers = generateHandlers;
exports.tsStringify = tsStringify;
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importDefault(require("fs"));
const path_1 = tslib_1.__importDefault(require("path"));
const prompts_1 = require("@inquirer/prompts");
const common_1 = require("@subql/common");
const chalk_1 = tslib_1.__importDefault(require("chalk"));
const lodash_1 = require("lodash");
const yaml_1 = require("yaml");
const constants_1 = require("../constants");
const modulars_1 = require("../modulars");
const utils_1 = require("../utils");
const SCAFFOLD_HANDLER_TEMPLATE_PATH = path_1.default.resolve(__dirname, '../template/scaffold-handlers.ts.ejs');
exports.ROOT_MAPPING_DIR = 'src/mappings';
exports.DEFAULT_HANDLER_BUILD_PATH = './dist/index.js';
exports.DEFAULT_ABI_DIR = '/abis';
function removeKeyword(inputString) {
    return inputString.replace(/^(event|function) /, '');
}
async function prepareAbiDirectory(abiPath, rootPath) {
    const abiDirPath = path_1.default.join(rootPath, exports.DEFAULT_ABI_DIR);
    if (!fs_1.default.existsSync(abiDirPath)) {
        await fs_1.default.promises.mkdir(abiDirPath, { recursive: true });
    }
    if (fs_1.default.existsSync(path_1.default.join(abiDirPath, abiPath))) {
        return;
    }
    // Ensure abiPath is an absolute path
    const ensuredAbiPath = (0, utils_1.resolveToAbsolutePath)(abiPath);
    try {
        const abiFileContent = await fs_1.default.promises.readFile(ensuredAbiPath, 'utf8');
        await fs_1.default.promises.writeFile(path_1.default.join(abiDirPath, path_1.default.basename(ensuredAbiPath)), abiFileContent);
    }
    catch (e) {
        if (e.code === 'ENOENT') {
            throw new Error(`Unable to find abi at: ${abiPath}`);
        }
    }
}
function constructMethod(cleanedFragment) {
    return Object.keys(cleanedFragment).map((f) => {
        return {
            name: cleanedFragment[f].name,
            method: f,
        };
    });
}
async function promptSelectables(method, availableMethods) {
    const selectedMethods = {};
    const choseArray = await (0, prompts_1.checkbox)({
        message: `Select ${method}`,
        choices: Object.keys(availableMethods).map((key) => ({ value: key })),
    });
    choseArray.forEach((choice) => {
        selectedMethods[choice] = availableMethods[choice];
    });
    return selectedMethods;
}
function filterObjectsByStateMutability(obj) {
    return (0, lodash_1.pickBy)(obj, (e) => e.stateMutability !== 'view');
}
function getFragmentFormats(fragment) {
    return {
        full: removeKeyword(fragment.format('full')),
        min: removeKeyword(fragment.format('minimal')),
    };
}
function generateHandlerName(name, abiName, type) {
    return `handle${(0, lodash_1.upperFirst)(name)}${(0, lodash_1.upperFirst)(abiName)}${(0, lodash_1.upperFirst)(type)}`;
}
function generateFormattedHandlers(userInput, abiName, kindModifier) {
    const formattedHandlers = [];
    userInput.functions.forEach((fn) => {
        const handler = {
            handler: generateHandlerName(fn.name, abiName, 'tx'),
            kind: kindModifier('EthereumHandlerKind.Call'), // union type
            filter: {
                function: fn.method,
            },
        };
        formattedHandlers.push(handler);
    });
    userInput.events.forEach((event) => {
        const handler = {
            handler: generateHandlerName(event.name, abiName, 'log'),
            kind: kindModifier('EthereumHandlerKind.Event'), // Should be union type
            filter: {
                topics: [event.method],
            },
        };
        formattedHandlers.push(handler);
    });
    return formattedHandlers;
}
function constructDatasourcesTs(userInput) {
    const ethModule = (0, modulars_1.loadDependency)(common_1.NETWORK_FAMILY.ethereum);
    const abiName = ethModule.parseContractPath(userInput.abiPath).name;
    const formattedHandlers = generateFormattedHandlers(userInput, abiName, (kind) => kind);
    const handlersString = tsStringify(formattedHandlers);
    return `{
    kind: EthereumDatasourceKind.Runtime,
    startBlock: ${userInput.startBlock},
    options: {
      abi: '${abiName}',
      ${userInput.address && `address: '${userInput.address}',`}
    },
    assets: new Map([['${abiName}', {file: '${userInput.abiPath}'}]]),
    mapping: {
      file: '${exports.DEFAULT_HANDLER_BUILD_PATH}',
      handlers: ${handlersString}
    }
  }`;
}
function constructDatasourcesYaml(userInput) {
    const ethModule = (0, modulars_1.loadDependency)(common_1.NETWORK_FAMILY.ethereum);
    const abiName = ethModule.parseContractPath(userInput.abiPath).name;
    const formattedHandlers = generateFormattedHandlers(userInput, abiName, (kind) => {
        if (kind === 'EthereumHandlerKind.Call')
            return 'ethereum/TransactionHandler';
        return 'ethereum/LogHandler';
    });
    const assets = new Map([[abiName, { file: userInput.abiPath }]]);
    return {
        kind: 'ethereum/Runtime',
        startBlock: userInput.startBlock,
        options: {
            abi: abiName,
            ...(userInput.address && { address: userInput.address }),
        },
        assets: assets,
        mapping: {
            file: exports.DEFAULT_HANDLER_BUILD_PATH,
            handlers: formattedHandlers,
        },
    };
}
// Selected fragments
async function prepareInputFragments(type, rawInput, availableFragments, abiName) {
    if (!rawInput) {
        return promptSelectables(type, availableFragments);
    }
    if (rawInput === '*') {
        return availableFragments;
    }
    const selectedFragments = {};
    rawInput.split(',').forEach((input) => {
        const casedInput = input.trim().toLowerCase();
        const matchFragment = Object.entries(availableFragments).find((entry) => {
            const [key, value] = entry;
            if (casedInput === availableFragments[key].name.toLowerCase()) {
                selectedFragments[key] = availableFragments[key];
                return value;
            }
        });
        if (!matchFragment) {
            throw new Error(chalk_1.default.red(`'${input}' is not a valid ${type} on ${abiName}`));
        }
    });
    return selectedFragments;
}
function filterExistingFragments(fragments, existingMethods) {
    const cleanFragments = {};
    for (const key in fragments) {
        const fragmentFormats = Object.values(getFragmentFormats(fragments[key])).concat(key);
        const diff = (0, lodash_1.difference)(fragmentFormats, existingMethods);
        if (diff.length === 3) {
            diff.forEach((fragKey) => {
                if (fragments[fragKey]) {
                    cleanFragments[fragKey] = fragments[fragKey];
                }
            });
        }
    }
    return cleanFragments;
}
function filterExistingMethods(eventFragments, functionFragments, dataSources, address, extractor) {
    const { existingEvents, existingFunctions } = extractor(dataSources, address && address.toLowerCase());
    return [
        filterExistingFragments(eventFragments, existingEvents),
        filterExistingFragments(functionFragments, existingFunctions),
    ];
}
const yamlExtractor = (dataSources, casedInputAddress) => {
    const existingEvents = [];
    const existingFunctions = [];
    dataSources
        .filter((d) => {
        const dsAddress = d.options?.address?.toLowerCase();
        return casedInputAddress ? casedInputAddress === dsAddress : !dsAddress;
    })
        .forEach((ds) => {
        ds.mapping.handlers.forEach((handler) => {
            if (!handler.filter)
                return;
            const topics = handler.filter.topics?.[0];
            const func = handler.filter.function;
            if (topics) {
                existingEvents.push(topics);
            }
            if (func) {
                existingFunctions.push(func);
            }
        });
    });
    return { existingEvents, existingFunctions };
};
exports.yamlExtractor = yamlExtractor;
const tsExtractor = (dataSources, casedInputAddress) => {
    const existingEvents = [];
    const existingFunctions = [];
    (0, utils_1.splitArrayString)(dataSources)
        .filter((d) => {
        const match = d.match(constants_1.ADDRESS_REG);
        return match && match.length >= 2 && match[1].toLowerCase() === casedInputAddress;
    })
        .forEach((d) => {
        const extractedValue = (0, utils_1.extractFromTs)(d, { handlers: undefined });
        const regResult = (0, utils_1.extractFromTs)(extractedValue.handlers, {
            topics: constants_1.TOPICS_REG,
            function: constants_1.FUNCTION_REG,
        });
        if (regResult.topics !== null) {
            existingEvents.push(regResult.topics[0]);
        }
        if (regResult.function !== null) {
            existingFunctions.push(regResult.function);
        }
    });
    return { existingEvents, existingFunctions };
};
exports.tsExtractor = tsExtractor;
async function getManifestData(manifestPath) {
    const existingManifest = await fs_1.default.promises.readFile(path_1.default.join(manifestPath), 'utf8');
    return (0, yaml_1.parseDocument)(existingManifest);
}
function prependDatasources(dsStr, toPendStr) {
    if (dsStr.trim().startsWith('[') && dsStr.trim().endsWith(']')) {
        // Insert the object string right after the opening '['
        return dsStr.trim().replace('[', `[${toPendStr},`);
    }
    else {
        throw new Error('Input string is not a valid JSON array string');
    }
}
async function generateManifestTs(manifestPath, userInput, existingManifestData) {
    const inputDs = constructDatasourcesTs(userInput);
    const extractedDs = (0, utils_1.extractFromTs)(existingManifestData, { dataSources: undefined });
    const v = prependDatasources(extractedDs.dataSources, inputDs);
    const updateManifest = (0, utils_1.replaceArrayValueInTsManifest)(existingManifestData, 'dataSources', v);
    await fs_1.default.promises.writeFile(manifestPath, updateManifest, 'utf8');
}
async function generateManifestYaml(manifestPath, userInput, existingManifestData) {
    const inputDs = constructDatasourcesYaml(userInput);
    const dsNode = existingManifestData.get('dataSources');
    if (!dsNode || !dsNode.items.length) {
        // To ensure output is in yaml format
        const cleanDs = new yaml_1.YAMLSeq();
        cleanDs.add(inputDs);
        existingManifestData.set('dataSources', cleanDs);
    }
    else {
        dsNode.add(inputDs);
    }
    await fs_1.default.promises.writeFile(path_1.default.join(manifestPath), existingManifestData.toString(), 'utf8');
}
function constructHandlerProps(methods, abiName) {
    const handlers = [];
    const [events, functions] = methods;
    functions.forEach((fn) => {
        handlers.push({
            name: generateHandlerName(fn.name, abiName, 'tx'),
            argName: 'tx',
            argType: `${(0, lodash_1.upperFirst)(fn.name)}Transaction`,
        });
    });
    events.forEach((event) => {
        handlers.push({
            name: generateHandlerName(event.name, abiName, 'log'),
            argName: 'log',
            argType: `${(0, lodash_1.upperFirst)(event.name)}Log`,
        });
    });
    return {
        name: abiName,
        handlers: handlers,
    };
}
async function generateHandlers(selectedMethods, projectPath, abiName) {
    const abiProps = constructHandlerProps(selectedMethods, abiName);
    const fileName = `${abiName}Handlers`;
    try {
        await (0, utils_1.renderTemplate)(SCAFFOLD_HANDLER_TEMPLATE_PATH, path_1.default.join(projectPath, exports.ROOT_MAPPING_DIR, `${fileName}.ts`), {
            props: {
                abis: [abiProps],
            },
            helper: { upperFirst: lodash_1.upperFirst },
        });
        fs_1.default.appendFileSync(path_1.default.join(projectPath, 'src/index.ts'), `\nexport * from "./mappings/${fileName}"`);
    }
    catch (e) {
        throw new Error(`Unable to generate handler scaffolds. ${e.message}`);
    }
}
function tsStringify(obj, indent = 2, currentIndent = 0) {
    if (typeof obj !== 'object' || obj === null) {
        if (typeof obj === 'string' && obj.includes('EthereumHandlerKind')) {
            return obj; // Return the string as-is without quotes
        }
        return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
        const items = obj.map((item) => tsStringify(item, indent, currentIndent + indent));
        return `[\n${items.map((item) => ' '.repeat(currentIndent + indent) + item).join(',\n')}\n${' '.repeat(currentIndent)}]`;
    }
    const entries = Object.entries(obj);
    const result = entries.map(([key, value]) => {
        const valueStr = tsStringify(value, indent, currentIndent + indent);
        return `${' '.repeat(currentIndent + indent)}${key}: ${valueStr}`;
    });
    return `{\n${result.join(',\n')}\n${' '.repeat(currentIndent)}}`;
}
//# sourceMappingURL=generate-controller.js.map