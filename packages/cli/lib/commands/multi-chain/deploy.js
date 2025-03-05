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
const common_1 = require("@subql/common");
const chalk_1 = tslib_1.__importDefault(require("chalk"));
const ora_1 = tslib_1.__importDefault(require("ora"));
const yaml_1 = tslib_1.__importDefault(require("yaml"));
const constants_1 = require("../../constants");
const deploy_controller_1 = require("../../controller/deploy-controller");
const publish_controller_1 = require("../../controller/publish-controller");
const utils_1 = require("../../utils");
const deploy_1 = require("../deployment/deploy");
class MultiChainDeploy extends core_1.Command {
    static description = 'Multi-chain deployment to hosted service';
    static flags = {
        ...deploy_controller_1.DefaultDeployFlags,
        location: core_1.Flags.string({ char: 'f', description: 'from project folder or specify manifest file', required: true }),
        ipfs: core_1.Flags.string({ description: 'IPFS gateway endpoint', required: false }),
    };
    async run() {
        const { flags } = await this.parse(MultiChainDeploy);
        const authToken = await (0, utils_1.checkToken)();
        const location = flags.location ? (0, utils_1.resolveToAbsolutePath)(flags.location) : process.cwd();
        // Make sure build first, generated project yaml could be added to the project (instead of ts)
        const project = (0, common_1.getProjectRootAndManifest)(location);
        const fullPaths = project.manifests.map((manifest) => path_1.default.join(project.root, manifest));
        let multichainManifestPath = (0, common_1.getMultichainManifestPath)(location);
        if (!multichainManifestPath) {
            throw new Error(chalk_1.default.bgRedBright('Selected project is not multi-chain. Please set correct file.\n\n https://academy.subquery.network/build/multi-chain.html'));
        }
        multichainManifestPath = path_1.default.join(project.root, multichainManifestPath);
        const multichainManifestObject = yaml_1.default.parse(fs_1.default.readFileSync(multichainManifestPath, 'utf8'));
        const spinner = (0, ora_1.default)('Uploading project to IPFS').start();
        const fileToCidMap = await (0, publish_controller_1.uploadToIpfs)(fullPaths, authToken.trim(), multichainManifestPath, flags.ipfs).catch((e) => {
            spinner.fail(e.message);
            this.error(e);
        });
        spinner.succeed('Uploaded project to IPFS');
        flags.org = await (0, utils_1.valueOrPrompt)(flags.org, 'Enter organisation', 'Organisation is required');
        flags.projectName = await (0, utils_1.valueOrPrompt)(flags.projectName, 'Enter project name', 'Project name is required');
        // Multichain query descriptor, The IPFS provided for deployment here must be a directory
        const ipfsCID = (0, publish_controller_1.getDirectoryCid)(fileToCidMap);
        (0, assert_1.default)(ipfsCID, 'Multichain deployment CID not found');
        const projectInfo = await (0, deploy_controller_1.projectsInfo)(authToken, flags.org, flags.projectName, constants_1.ROOT_API_URL_PROD, flags.type);
        const chains = [];
        const endpoints = (0, deploy_controller_1.splitMultichainDataFields)(flags.endpoint);
        const dictionaries = (0, deploy_controller_1.splitMultichainDataFields)(flags.dict);
        const indexerVersions = (0, deploy_controller_1.splitMultichainDataFields)(flags.indexerVersion);
        if (!flags.queryVersion) {
            try {
                flags.queryVersion = await (0, deploy_1.promptImageVersion)(multichainManifestObject.query.name, multichainManifestObject.query.version, flags.useDefaults, authToken, 'Enter query version');
            }
            catch (e) {
                throw new Error(chalk_1.default.bgRedBright('Query version is required'));
            }
        }
        flags.queryVersion = (0, utils_1.addV)(flags.queryVersion);
        for await (const [multichainProjectPath, multichainProjectCid] of fileToCidMap) {
            if (!multichainProjectPath || multichainProjectPath === path_1.default.basename(multichainManifestPath))
                continue;
            const validator = await (0, deploy_controller_1.ipfsCID_validate)(multichainProjectCid, authToken, constants_1.ROOT_API_URL_PROD);
            if (!validator.valid) {
                throw new Error(chalk_1.default.bgRedBright('Invalid IPFS CID'));
            }
            (0, assert_1.default)(validator.chainId, 'Please set chainId in your project');
            if (!indexerVersions[validator.chainId]) {
                (0, assert_1.default)(validator.manifestRunner, 'Please set manifestRunner in your project');
                try {
                    indexerVersions[validator.chainId] = await (0, deploy_1.promptImageVersion)(validator.manifestRunner.node.name, validator.manifestRunner.node.version, flags.useDefaults, authToken, `Enter indexer version for ${multichainProjectPath}`);
                }
                catch (e) {
                    throw new Error(chalk_1.default.bgRedBright('Indexer version is required'), { cause: e });
                }
            }
            indexerVersions[validator.chainId] = (0, utils_1.addV)(indexerVersions[validator.chainId]);
            if (!endpoints[validator.chainId]) {
                if (flags.useDefaults) {
                    throw new Error(chalk_1.default.red('Please ensure a endpoint valid is passed using --endpoint flag with syntax chainId:rpc_endpoint,chainId2:rpc_endpoint2...'));
                }
                endpoints[validator.chainId] = await (0, prompts_1.input)({
                    message: `Enter endpoint for ${multichainProjectPath}`,
                    required: true,
                });
            }
            chains.push((0, deploy_controller_1.generateDeploymentChain)({
                cid: multichainProjectCid,
                dictEndpoint: dictionaries[validator.chainId],
                endpoint: [endpoints[validator.chainId]],
                flags: flags,
                indexerImageVersion: indexerVersions[validator.chainId],
            }));
        }
        this.log('Deploying SubQuery multi-chain project to Hosted Service, IPFS: ', ipfsCID);
        await (0, deploy_controller_1.executeProjectDeployment)({
            log: this.log.bind(this),
            authToken,
            chains,
            flags,
            ipfsCID: ipfsCID,
            org: flags.org,
            projectInfo,
            projectName: flags.projectName,
            queryVersion: flags.queryVersion,
        });
    }
}
exports.default = MultiChainDeploy;
//# sourceMappingURL=deploy.js.map