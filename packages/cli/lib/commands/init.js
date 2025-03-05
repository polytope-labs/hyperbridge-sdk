"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const assert_1 = tslib_1.__importDefault(require("assert"));
const fs_1 = tslib_1.__importDefault(require("fs"));
const path_1 = tslib_1.__importDefault(require("path"));
const prompts_1 = require("@inquirer/prompts");
const core_1 = require("@oclif/core");
const chalk_1 = tslib_1.__importDefault(require("chalk"));
const fuzzy_1 = tslib_1.__importDefault(require("fuzzy"));
const ora_1 = tslib_1.__importDefault(require("ora"));
const init_controller_1 = require("../controller/init-controller");
const utils_1 = require("../utils");
const generate_1 = tslib_1.__importDefault(require("./codegen/generate"));
// Helper function for fuzzy search on prompt input
function filterInput(arr) {
    return (input) => {
        input ??= '';
        return Promise.resolve(fuzzy_1.default.filter(input, arr).map((r) => ({ value: r.original })));
    };
}
class Init extends core_1.Command {
    static description = 'Initialize a scaffold subquery project';
    static flags = {
        force: core_1.Flags.boolean({ char: 'f' }),
        location: core_1.Flags.string({ char: 'l', description: 'local folder to create the project in' }),
        'install-dependencies': core_1.Flags.boolean({ description: 'Install dependencies as well', default: false }),
        npm: core_1.Flags.boolean({ description: 'Force using NPM instead of yarn, only works with `install-dependencies` flag' }),
        abiPath: core_1.Flags.string({ description: 'path to abi file' }),
    };
    static args = {
        projectName: core_1.Args.string({
            description: 'Give the starter project name',
        }),
    };
    async run() {
        const { args, flags } = await this.parse(Init);
        const location = flags.location ? (0, utils_1.resolveToAbsolutePath)(flags.location) : process.cwd();
        const project = {};
        project.name = args.projectName
            ? args.projectName
            : await (0, prompts_1.input)({
                message: 'Project name',
                default: 'subql-starter',
                required: true,
            });
        if (fs_1.default.existsSync(path_1.default.join(location, `${project.name}`))) {
            throw new Error(`Directory ${project.name} exists, try another project name`);
        }
        const networkTemplates = await (0, init_controller_1.fetchNetworks)();
        //Family selection
        const families = networkTemplates.map(({ name }) => name);
        const networkFamily = await (0, prompts_1.search)({
            message: 'Select a network family',
            source: filterInput(families),
            pageSize: 20,
        });
        // if network family is of ethereum, then should prompt them an abiPath
        const selectedFamily = networkTemplates.find((family) => family.name === networkFamily);
        (0, assert_1.default)(selectedFamily, 'No network family selected');
        // Network selection
        const networkStrArr = selectedFamily.networks.map((n) => n.name);
        const network = await (0, prompts_1.search)({
            message: 'Select a network',
            source: filterInput(networkStrArr),
            pageSize: 20,
        });
        const selectedNetwork = selectedFamily.networks.find((v) => network === v.name);
        (0, assert_1.default)(selectedNetwork, 'No network selected');
        const candidateProjects = await (0, init_controller_1.fetchExampleProjects)(selectedFamily.code, selectedNetwork.code);
        let selectedProject;
        // Templates selection
        const paddingWidth = candidateProjects.map(({ name }) => name.length).reduce((acc, xs) => Math.max(acc, xs)) + 5;
        const templateDisplays = candidateProjects.map(({ description, name }) => `${name.padEnd(paddingWidth, ' ')}${chalk_1.default.gray(description)}`);
        templateDisplays.push(`${'Other'.padEnd(paddingWidth, ' ')}${chalk_1.default.gray('Enter a custom git endpoint')}`);
        const templateDisplay = await (0, prompts_1.search)({
            message: 'Select a template project',
            source: filterInput(templateDisplays),
            pageSize: 20,
        });
        const templateName = templateDisplay.split(' ')[0];
        if (templateName === 'Other') {
            const url = await (0, prompts_1.input)({
                message: 'Enter a git repo URL',
                required: true,
            });
            selectedProject = {
                remote: url,
                name: templateName,
                path: '',
                description: '',
            };
        }
        else {
            selectedProject = candidateProjects.find((project) => project.name === templateName);
        }
        (0, assert_1.default)(selectedProject, 'No project selected');
        const projectPath = await (0, init_controller_1.cloneProjectTemplate)(location, project.name, selectedProject);
        const { isMultiChainProject } = await this.setupProject(project, projectPath, flags);
        if (isMultiChainProject)
            return;
        if (await (0, init_controller_1.validateEthereumProjectManifest)(projectPath)) {
            const loadAbi = await (0, prompts_1.confirm)({
                message: 'Do you want to generate scaffolding from an existing contract abi?',
                default: false,
            });
            if (loadAbi) {
                await this.createProjectScaffold(projectPath);
            }
        }
    }
    async setupProject(project, projectPath, flags) {
        const { author: defaultAuthor, description: defaultDescription, endpoint: defaultEndpoint, isMultiChainProject, } = await (0, init_controller_1.readDefaults)(projectPath);
        if (!isMultiChainProject) {
            const projectEndpoints = this.extractEndpoints(defaultEndpoint);
            const userInput = await (0, prompts_1.input)({
                message: 'RPC endpoint:',
                default: projectEndpoints[0],
                required: false,
            });
            if (!projectEndpoints.includes(userInput)) {
                projectEndpoints.push(userInput);
            }
            project.endpoint = projectEndpoints;
        }
        const descriptionHint = defaultDescription.substring(0, 40).concat('...');
        project.author = await (0, prompts_1.input)({ message: 'Author', required: true, default: defaultAuthor });
        project.description = await (0, prompts_1.input)({
            message: 'Description',
            required: false,
            default: descriptionHint,
        }).then((description) => {
            return description === descriptionHint ? defaultDescription : description;
        });
        const spinner = (0, ora_1.default)('Preparing project').start();
        await (0, init_controller_1.prepare)(projectPath, project, isMultiChainProject);
        spinner.stop();
        if (flags['install-dependencies']) {
            const spinner = (0, ora_1.default)('Installing dependencies').start();
            (0, init_controller_1.installDependencies)(projectPath, flags.npm);
            spinner.stop();
        }
        this.log(`${project.name} is ready${isMultiChainProject ? ' as a multi-chain project' : ''}`);
        return { isMultiChainProject };
    }
    async createProjectScaffold(projectPath) {
        await (0, init_controller_1.prepareProjectScaffold)(projectPath);
        const abiFilePath = await (0, prompts_1.input)({
            message: 'Path to ABI',
        });
        const contractAddress = await (0, prompts_1.input)({
            message: 'Please provide a contract address (optional)',
        });
        const startBlock = await (0, prompts_1.input)({
            message: 'Please provide startBlock when the contract was deployed or first used',
            default: '1',
        });
        const cleanedContractAddress = contractAddress.replace(/[`'"]/g, '');
        this.log(`Generating scaffold handlers and manifest from ${abiFilePath}`);
        await generate_1.default.run([
            '-f',
            projectPath,
            '--abiPath',
            `${abiFilePath}`,
            '--address',
            `${cleanedContractAddress}`,
            '--startBlock',
            `${startBlock}`,
        ]);
    }
    extractEndpoints(endpointConfig) {
        if (typeof endpointConfig === 'string') {
            return [endpointConfig];
        }
        if (endpointConfig instanceof Array) {
            return endpointConfig;
        }
        return Object.keys(endpointConfig);
    }
}
exports.default = Init;
//# sourceMappingURL=init.js.map