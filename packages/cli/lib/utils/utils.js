"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.delay = delay;
exports.valueOrPrompt = valueOrPrompt;
exports.addV = addV;
exports.checkToken = checkToken;
exports.errorHandle = errorHandle;
exports.buildProjectKey = buildProjectKey;
exports.renderTemplate = renderTemplate;
exports.prepareDirPath = prepareDirPath;
exports.resolveToAbsolutePath = resolveToAbsolutePath;
exports.isValidEnum = isValidEnum;
exports.findReplace = findReplace;
exports.findMatchingIndices = findMatchingIndices;
exports.findArrayIndicesTsManifest = findArrayIndicesTsManifest;
exports.replaceArrayValueInTsManifest = replaceArrayValueInTsManifest;
exports.extractArrayValueFromTsManifest = extractArrayValueFromTsManifest;
exports.extractFromTs = extractFromTs;
exports.splitArrayString = splitArrayString;
exports.validateEthereumTsManifest = validateEthereumTsManifest;
exports.defaultYamlManifestPath = defaultYamlManifestPath;
exports.defaultTSManifestPath = defaultTSManifestPath;
exports.defaultEnvPath = defaultEnvPath;
exports.defaultEnvDevelopPath = defaultEnvDevelopPath;
exports.defaultEnvLocalPath = defaultEnvLocalPath;
exports.defaultEnvDevelopLocalPath = defaultEnvDevelopLocalPath;
exports.defaultGitIgnorePath = defaultGitIgnorePath;
exports.copyFolderSync = copyFolderSync;
exports.defaultMultiChainYamlManifestPath = defaultMultiChainYamlManifestPath;
exports.isMultichain = isMultichain;
const tslib_1 = require("tslib");
const assert_1 = tslib_1.__importDefault(require("assert"));
const fs_1 = tslib_1.__importStar(require("fs"));
const os_1 = tslib_1.__importDefault(require("os"));
const path_1 = tslib_1.__importDefault(require("path"));
const prompts_1 = require("@inquirer/prompts");
const common_1 = require("@subql/common");
const axios_1 = tslib_1.__importDefault(require("axios"));
const ejs_1 = tslib_1.__importDefault(require("ejs"));
const yaml = tslib_1.__importStar(require("js-yaml"));
const json5_1 = tslib_1.__importDefault(require("json5"));
const rimraf_1 = require("rimraf");
const constants_1 = require("../constants");
async function delay(sec) {
    return new Promise((resolve) => {
        setTimeout(resolve, sec * 1000);
    });
}
async function valueOrPrompt(value, msg, error) {
    if (value)
        return value;
    try {
        return await (0, prompts_1.input)({
            message: msg,
            required: true,
        });
    }
    catch (e) {
        throw new Error(error);
    }
}
function addV(str) {
    // replaced includes to first byte.
    if (str && str[0] !== 'v') {
        return `v${str}`;
    }
    return str;
}
async function checkToken(token_path = constants_1.ACCESS_TOKEN_PATH) {
    const reqInput = () => (0, prompts_1.input)({ message: 'Token cannot be found, Enter token', required: true });
    const envToken = process.env.SUBQL_ACCESS_TOKEN;
    if (envToken)
        return envToken;
    if ((0, fs_1.existsSync)(token_path)) {
        try {
            const authToken = (0, fs_1.readFileSync)(token_path, 'utf8');
            if (!authToken) {
                return await reqInput();
            }
            return authToken.trim();
        }
        catch (e) {
            return reqInput();
        }
    }
    else {
        return reqInput();
    }
}
function errorHandle(e, msg) {
    if (axios_1.default.isAxiosError(e) && e?.response?.data) {
        return new Error(`${msg} ${e.response.data.message ?? e.response.data}`);
    }
    return new Error(`${msg} ${e.message}`);
}
function buildProjectKey(org, projectName) {
    return encodeURIComponent(`${org}/${projectName.toLowerCase()}`);
}
async function renderTemplate(templatePath, outputPath, templateData) {
    const data = await ejs_1.default.renderFile(templatePath, templateData);
    await fs_1.default.promises.writeFile(outputPath, data);
}
async function prepareDirPath(path, recreate) {
    try {
        await (0, rimraf_1.rimraf)(path);
        if (recreate) {
            await fs_1.default.promises.mkdir(path, { recursive: true });
        }
    }
    catch (e) {
        throw new Error(`Failed to prepare ${path}: ${e.message}`);
    }
}
// oclif's default path resolver only applies when parsed as `--flag path`
// else it would not resolve, hence we need to resolve it manually.
function resolveToAbsolutePath(inputPath) {
    const regex = new RegExp(`^~(?=$|[/\\\\])`);
    return path_1.default.resolve(inputPath.replace(regex, os_1.default.homedir()));
}
function isValidEnum(enumType, input) {
    return Object.values(enumType).includes(input);
}
function findReplace(manifest, replacer, value) {
    return manifest.replace(replacer, value);
}
function findMatchingIndices(content, startChar, endChar, startFrom = 0) {
    //  JavaScript's regex engine does not support recursive patterns like (?1).
    //  This regex would work in engines that support recursion, such as PCRE (Perl-Compatible Regular Expressions).
    let openCount = 0;
    let startIndex;
    const pairs = [];
    for (let i = startFrom; i < content.length; i++) {
        if (content[i] === startChar) {
            if (openCount === 0)
                startIndex = i;
            openCount++;
        }
        else if (content[i] === endChar) {
            openCount--;
            if (openCount === 0) {
                (0, assert_1.default)(startIndex !== undefined, 'startIndex should be defined');
                pairs.push([startIndex, i]);
                break;
            }
        }
    }
    if (openCount !== 0)
        throw new Error(`Unbalanced ${startChar} and ${endChar}`);
    return pairs;
}
function findArrayIndicesTsManifest(content, key) {
    const start = content.indexOf(`${key}:`);
    if (start === -1)
        throw new Error(`${key} not found`);
    const pairs = findMatchingIndices(content, '[', ']', start);
    if (pairs.length === 0)
        throw new Error(`${key} contains unbalanced brackets`);
    return pairs[0];
}
function replaceArrayValueInTsManifest(content, key, newValue) {
    const [startIndex, endIndex] = findArrayIndicesTsManifest(content, key);
    return content.slice(0, startIndex) + newValue + content.slice(endIndex + 1);
}
function extractArrayValueFromTsManifest(content, key) {
    const [startIndex, endIndex] = findArrayIndicesTsManifest(content, key);
    return content.slice(startIndex, endIndex + 1);
}
function extractFromTs(manifest, patterns) {
    const result = {};
    // TODO should extract then validate value type ?
    // check what the following char is after key
    const arrKeys = ['endpoint', 'topics'];
    const nestArr = ['dataSources', 'handlers'];
    for (const key in patterns) {
        if (!nestArr.includes(key)) {
            const regExp = patterns[key];
            (0, assert_1.default)(regExp, `Pattern for ${key} is not defined`);
            const match = manifest.match(regExp);
            if (arrKeys.includes(key) && match) {
                const inputStr = match[1].replace(/`/g, '"');
                const jsonOutput = json5_1.default.parse(inputStr);
                result[key] = Array.isArray(jsonOutput) ? jsonOutput : [jsonOutput];
            }
            else {
                result[key] = match ? match[1] : null;
            }
        }
        else {
            result[key] = extractArrayValueFromTsManifest(manifest, key);
        }
    }
    return result;
}
function splitArrayString(arrayStr) {
    // Remove the starting and ending square brackets
    const content = arrayStr.trim().slice(1, -1).trim();
    const pairs = [];
    let lastEndIndex = 0;
    while (lastEndIndex < content.length) {
        const newPairs = findMatchingIndices(content, '{', '}', lastEndIndex);
        if (newPairs.length === 0)
            break;
        pairs.push(newPairs[0]);
        lastEndIndex = newPairs[0][1] + 1;
    }
    return pairs.map(([start, end]) => {
        // Extract the string and further process to remove excess whitespace
        const extracted = content.slice(start, end + 1).trim();
        return extracted.replace(/\s+/g, ' ');
    });
}
// Cold validate on ts manifest, for generate scaffold command
function validateEthereumTsManifest(manifest) {
    const typePattern = /@subql\/types-ethereum/;
    const nodePattern = /@subql\/node-ethereum/;
    return !!typePattern.test(manifest) && !!nodePattern.test(manifest);
}
function defaultYamlManifestPath(projectPath) {
    return path_1.default.join(projectPath, common_1.DEFAULT_MANIFEST);
}
function defaultTSManifestPath(projectPath) {
    return path_1.default.join(projectPath, common_1.DEFAULT_TS_MANIFEST);
}
function defaultEnvPath(projectPath) {
    return path_1.default.join(projectPath, common_1.DEFAULT_ENV);
}
function defaultEnvDevelopPath(projectPath) {
    return path_1.default.join(projectPath, common_1.DEFAULT_ENV_DEVELOP);
}
function defaultEnvLocalPath(projectPath) {
    return path_1.default.join(projectPath, common_1.DEFAULT_ENV_LOCAL);
}
function defaultEnvDevelopLocalPath(projectPath) {
    return path_1.default.join(projectPath, common_1.DEFAULT_ENV_DEVELOP_LOCAL);
}
function defaultGitIgnorePath(projectPath) {
    return path_1.default.join(projectPath, common_1.DEFAULT_GIT_IGNORE);
}
function copyFolderSync(source, target) {
    if (!fs_1.default.existsSync(target)) {
        fs_1.default.mkdirSync(target, { recursive: true });
    }
    fs_1.default.readdirSync(source).forEach((item) => {
        const sourcePath = path_1.default.join(source, item);
        const targetPath = path_1.default.join(target, item);
        if (fs_1.default.lstatSync(sourcePath).isDirectory()) {
            copyFolderSync(sourcePath, targetPath);
        }
        else {
            fs_1.default.copyFileSync(sourcePath, targetPath);
        }
    });
}
function defaultMultiChainYamlManifestPath(projectPath) {
    return path_1.default.join(projectPath, common_1.DEFAULT_MULTICHAIN_MANIFEST);
}
function isMultichain(location) {
    const multichainContent = yaml.load((0, fs_1.readFileSync)(location, 'utf8'));
    return !!multichainContent && !!multichainContent.projects;
}
//# sourceMappingURL=utils.js.map