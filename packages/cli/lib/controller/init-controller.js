"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchTemplates = fetchTemplates;
exports.fetchNetworks = fetchNetworks;
exports.fetchExampleProjects = fetchExampleProjects;
exports.cloneProjectGit = cloneProjectGit;
exports.cloneProjectTemplate = cloneProjectTemplate;
exports.readDefaults = readDefaults;
exports.prepare = prepare;
exports.preparePackage = preparePackage;
exports.prepareManifest = prepareManifest;
exports.addDotEnvConfigCode = addDotEnvConfigCode;
exports.prepareEnv = prepareEnv;
exports.prepareGitIgnore = prepareGitIgnore;
exports.installDependencies = installDependencies;
exports.prepareProjectScaffold = prepareProjectScaffold;
exports.validateEthereumProjectManifest = validateEthereumProjectManifest;
const tslib_1 = require("tslib");
const child_process_1 = tslib_1.__importStar(require("child_process"));
const fs_1 = tslib_1.__importDefault(require("fs"));
const path = tslib_1.__importStar(require("path"));
const common_1 = require("@subql/common");
const axios_1 = tslib_1.__importDefault(require("axios"));
const fs_extra_1 = require("fs-extra");
const rimraf_1 = require("rimraf");
const simple_git_1 = tslib_1.__importDefault(require("simple-git"));
const yaml_1 = require("yaml");
const constants_1 = require("../constants");
const modulars_1 = require("../modulars");
const types_1 = require("../types");
const utils_1 = require("../utils");
const axiosInstance = axios_1.default.create({ baseURL: constants_1.BASE_TEMPLATE_URl });
// GET /all
// https://templates.subquery.network/all
async function fetchTemplates() {
    try {
        const res = await axiosInstance.get('/all');
        return res.data.templates;
    }
    catch (e) {
        throw (0, utils_1.errorHandle)(e, `Update to reach endpoint '${constants_1.BASE_TEMPLATE_URl}/all`);
    }
}
// GET /networks
// https://templates.subquery.network/networks
async function fetchNetworks() {
    try {
        const res = await axiosInstance.get('/networks');
        return res.data.results;
    }
    catch (e) {
        throw (0, utils_1.errorHandle)(e, `Update to reach endpoint '${constants_1.BASE_TEMPLATE_URl}/networks`);
    }
}
// The family query param must be an exact case-insensitive match otherwise an empty result will be returned
async function fetchExampleProjects(familyCode, networkCode) {
    try {
        const res = await axiosInstance.get(`/networks/${familyCode}/${networkCode}`);
        return res.data.results;
    }
    catch (e) {
        throw (0, utils_1.errorHandle)(e, `Update to reach endpoint ${familyCode}/${networkCode}`);
    }
}
async function cloneProjectGit(localPath, projectName, projectRemote, branch) {
    const projectPath = path.join(localPath, projectName);
    try {
        await (0, simple_git_1.default)().clone(projectRemote, projectPath, ['-b', branch, '--single-branch']);
    }
    catch (e) {
        let err = 'Failed to clone starter template from git';
        try {
            (0, child_process_1.execSync)('git --version');
        }
        catch (_) {
            err += ', please install git and ensure that it is available from command line';
        }
        throw new Error(err);
    }
    return projectPath;
}
async function cloneProjectTemplate(localPath, projectName, selectedProject) {
    const projectPath = path.join(localPath, projectName);
    //make temp directory to store project
    const tempPath = await (0, common_1.makeTempDir)();
    //use sparse-checkout to clone project to temp directory
    await (0, simple_git_1.default)(tempPath).init().addRemote('origin', selectedProject.remote);
    await (0, simple_git_1.default)(tempPath).raw('sparse-checkout', 'set', selectedProject.path);
    await (0, simple_git_1.default)(tempPath).raw('pull', 'origin', 'main');
    // Copy content to project path
    (0, fs_extra_1.copySync)(path.join(tempPath, selectedProject.path), projectPath);
    // Clean temp folder
    fs_1.default.rmSync(tempPath, { recursive: true, force: true });
    return projectPath;
}
async function readDefaults(projectPath) {
    const packageData = await fs_1.default.promises.readFile(`${projectPath}/package.json`);
    const currentPackage = JSON.parse(packageData.toString());
    const author = currentPackage.author;
    const description = currentPackage.description;
    let endpoint;
    let isMultiChainProject = false;
    const defaultTsPath = (0, utils_1.defaultTSManifestPath)(projectPath);
    const defaultYamlPath = (0, utils_1.defaultYamlManifestPath)(projectPath);
    const defaultMultiChainPath = (0, utils_1.defaultMultiChainYamlManifestPath)(projectPath);
    if (fs_1.default.existsSync(defaultTsPath)) {
        const tsManifest = await fs_1.default.promises.readFile(defaultTsPath, 'utf8');
        const extractedTsValues = (0, utils_1.extractFromTs)(tsManifest.toString(), {
            endpoint: constants_1.ENDPOINT_REG,
        });
        endpoint = extractedTsValues.endpoint ?? [];
    }
    else if (fs_1.default.existsSync(defaultYamlPath)) {
        const yamlManifest = await fs_1.default.promises.readFile(defaultYamlPath, 'utf8');
        const extractedYamlValues = (0, yaml_1.parseDocument)(yamlManifest).toJS();
        endpoint = extractedYamlValues.network.endpoint;
    }
    else if (fs_1.default.existsSync(defaultMultiChainPath)) {
        endpoint = [];
        isMultiChainProject = true;
    }
    else {
        throw new Error('Failed to read manifest file while preparing the project');
    }
    return { endpoint, author, description, isMultiChainProject };
}
async function prepare(projectPath, project, isMultiChainProject = false) {
    try {
        if (!isMultiChainProject)
            await prepareEnv(projectPath, project);
    }
    catch (e) {
        throw new Error('Failed to prepare read or write .env file while preparing the project');
    }
    try {
        if (!isMultiChainProject)
            await prepareManifest(projectPath, project);
    }
    catch (e) {
        throw new Error('Failed to prepare read or write manifest while preparing the project');
    }
    try {
        await preparePackage(projectPath, project);
    }
    catch (e) {
        throw new Error('Failed to prepare read or write package.json while preparing the project');
    }
    try {
        await (0, rimraf_1.rimraf)(`${projectPath}/.git`);
    }
    catch (e) {
        throw new Error('Failed to remove .git from template project');
    }
    try {
        await prepareGitIgnore(projectPath);
    }
    catch (e) {
        throw new Error('Failed to prepare read or write .gitignore while preparing the project');
    }
}
async function preparePackage(projectPath, project) {
    //load and write package.json
    const packageData = await fs_1.default.promises.readFile(`${projectPath}/package.json`);
    const currentPackage = JSON.parse(packageData.toString());
    currentPackage.name = project.name;
    currentPackage.description = project.description ?? currentPackage.description;
    currentPackage.author = project.author;
    //add build and develop scripts
    currentPackage.scripts = {
        ...currentPackage.scripts,
        build: 'subql codegen && subql build',
        'build:develop': 'NODE_ENV=develop subql codegen && NODE_ENV=develop subql build',
    };
    //add dotenv package for env file support
    currentPackage.devDependencies = {
        ...currentPackage.devDependencies,
        dotenv: 'latest',
    };
    const newPackage = JSON.stringify(currentPackage, null, 2);
    await fs_1.default.promises.writeFile(`${projectPath}/package.json`, newPackage, 'utf8');
}
async function prepareManifest(projectPath, project) {
    //load and write manifest(project.ts/project.yaml)
    const tsPath = (0, utils_1.defaultTSManifestPath)(projectPath);
    const yamlPath = (0, utils_1.defaultYamlManifestPath)(projectPath);
    let manifestData;
    const isTs = fs_1.default.existsSync(tsPath);
    if (isTs) {
        const tsManifest = (await fs_1.default.promises.readFile(tsPath, 'utf8')).toString();
        //adding env config for endpoint.
        const formattedEndpoint = `process.env.ENDPOINT!?.split(',') as string[] | string`;
        const endpointUpdatedManifestData = (0, utils_1.findReplace)(tsManifest, constants_1.ENDPOINT_REG, `endpoint: ${formattedEndpoint}`);
        const chainIdUpdatedManifestData = (0, utils_1.findReplace)(endpointUpdatedManifestData, constants_1.CHAIN_ID_REG, `chainId: process.env.CHAIN_ID!`);
        manifestData = addDotEnvConfigCode(chainIdUpdatedManifestData);
    }
    else {
        //load and write manifest(project.yaml)
        const yamlManifest = await fs_1.default.promises.readFile(yamlPath, 'utf8');
        const data = (0, yaml_1.parseDocument)(yamlManifest);
        const clonedData = data.clone();
        const network = clonedData.get('network');
        network.set('endpoint', project.endpoint);
        clonedData.set('name', project.name);
        if ((0, types_1.isProjectSpecV1_0_0)(project)) {
            network.set('chainId', project.chainId);
        }
        manifestData = clonedData.toString();
    }
    await fs_1.default.promises.writeFile(isTs ? tsPath : yamlPath, manifestData, 'utf8');
}
function addDotEnvConfigCode(manifestData) {
    // add dotenv config after imports in project.ts file
    let snippetCodeIndex = -1;
    const manifestSections = manifestData.split('\n');
    for (let i = 0; i < manifestSections.length; i++) {
        if (manifestSections[i].trim() === '') {
            snippetCodeIndex = i + 1;
            break;
        }
    }
    if (snippetCodeIndex === -1) {
        snippetCodeIndex = 0;
    }
    const envConfigCodeSnippet = `
import * as dotenv from 'dotenv';
import path from 'path';

const mode = process.env.NODE_ENV || 'production';

// Load the appropriate .env file
const dotenvPath = path.resolve(__dirname, \`.env\${mode !== 'production' ? \`.$\{mode}\` : ''}\`);
dotenv.config({ path: dotenvPath });
`;
    // Inserting the env configuration code in project.ts
    const updatedTsProject = `${manifestSections.slice(0, snippetCodeIndex).join('\n') + envConfigCodeSnippet}\n${manifestSections.slice(snippetCodeIndex).join('\n')}`;
    return updatedTsProject;
}
async function prepareEnv(projectPath, project) {
    //load and write manifest(project.ts/project.yaml)
    const envPath = (0, utils_1.defaultEnvPath)(projectPath);
    const envDevelopPath = (0, utils_1.defaultEnvDevelopPath)(projectPath);
    const envLocalPath = (0, utils_1.defaultEnvLocalPath)(projectPath);
    const envDevelopLocalPath = (0, utils_1.defaultEnvDevelopLocalPath)(projectPath);
    let chainId;
    if ((0, types_1.isProjectSpecV1_0_0)(project)) {
        chainId = project.chainId;
    }
    else {
        const tsPath = (0, utils_1.defaultTSManifestPath)(projectPath);
        const tsManifest = (await fs_1.default.promises.readFile(tsPath, 'utf8')).toString();
        const match = tsManifest.match(constants_1.CAPTURE_CHAIN_ID_REG);
        if (match) {
            chainId = match[2];
        }
    }
    //adding env configs
    const envData = `ENDPOINT=${project.endpoint}\nCHAIN_ID=${chainId}`;
    await fs_1.default.promises.writeFile(envPath, envData, 'utf8');
    await fs_1.default.promises.writeFile(envDevelopPath, envData, 'utf8');
    await fs_1.default.promises.writeFile(envLocalPath, envData, 'utf8');
    await fs_1.default.promises.writeFile(envDevelopLocalPath, envData, 'utf8');
}
async function prepareGitIgnore(projectPath) {
    //load and write .gitignore
    const gitIgnorePath = (0, utils_1.defaultGitIgnorePath)(projectPath);
    const isGitIgnore = fs_1.default.existsSync(gitIgnorePath);
    if (isGitIgnore) {
        let gitIgnoreManifest = (await fs_1.default.promises.readFile(gitIgnorePath, 'utf8')).toString();
        //add local .env files in .gitignore
        gitIgnoreManifest += `\n# ENV local files\n.env.local\n.env.develop.local`;
        await fs_1.default.promises.writeFile(gitIgnorePath, gitIgnoreManifest, 'utf8');
    }
}
function installDependencies(projectPath, useNpm) {
    let command = 'yarn install';
    if (useNpm || !checkYarnExists()) {
        command = 'npm install';
    }
    child_process_1.default.execSync(command, { cwd: projectPath });
}
function checkYarnExists() {
    try {
        child_process_1.default.execSync('yarn --version');
        return true;
    }
    catch (e) {
        return false;
    }
}
async function prepareProjectScaffold(projectPath) {
    // remove all existing abis & handler files
    await (0, utils_1.prepareDirPath)(path.join(projectPath, 'abis/'), false);
    await (0, utils_1.prepareDirPath)(path.join(projectPath, 'src/mappings/'), true);
    const defaultTsPath = (0, utils_1.defaultTSManifestPath)(projectPath);
    try {
        //  clean dataSources
        if (fs_1.default.existsSync(defaultTsPath)) {
            // ts check should be first
            await prepareProjectScaffoldTS(defaultTsPath);
        }
        else {
            await prepareProjectScaffoldYAML((0, utils_1.defaultYamlManifestPath)(projectPath));
        }
    }
    catch (e) {
        throw new Error('Failed to prepare project scaffold');
    }
    // remove handler file from index.ts
    fs_1.default.truncateSync(path.join(projectPath, 'src/index.ts'), 0);
}
async function prepareProjectScaffoldTS(defaultTsPath) {
    const manifest = await fs_1.default.promises.readFile(defaultTsPath, 'utf8');
    const updateManifest = (0, utils_1.replaceArrayValueInTsManifest)(manifest, 'dataSources', '[]');
    await fs_1.default.promises.writeFile(defaultTsPath, updateManifest, 'utf8');
}
async function prepareProjectScaffoldYAML(defaultYamlPath) {
    const manifest = (0, yaml_1.parseDocument)(await fs_1.default.promises.readFile(defaultYamlPath, 'utf8'));
    manifest.set('dataSources', new yaml_1.YAMLSeq());
    await fs_1.default.promises.writeFile(defaultYamlPath, manifest.toString(), 'utf8');
}
async function validateEthereumProjectManifest(projectPath) {
    let manifest;
    const isTs = fs_1.default.existsSync(path.join(projectPath, common_1.DEFAULT_TS_MANIFEST));
    if (isTs) {
        manifest = (await fs_1.default.promises.readFile(path.join(projectPath, common_1.DEFAULT_TS_MANIFEST), 'utf8')).toString();
    }
    else {
        manifest = (0, common_1.loadFromJsonOrYaml)(path.join(projectPath, common_1.DEFAULT_MANIFEST));
    }
    try {
        return isTs
            ? (0, utils_1.validateEthereumTsManifest)(manifest)
            : !!(0, modulars_1.loadDependency)(common_1.NETWORK_FAMILY.ethereum).parseProjectManifest(manifest);
    }
    catch (e) {
        return false;
    }
}
//# sourceMappingURL=init-controller.js.map