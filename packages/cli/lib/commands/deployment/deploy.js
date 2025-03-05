"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.promptImageVersion = promptImageVersion;
const tslib_1 = require("tslib");
const assert_1 = tslib_1.__importDefault(require("assert"));
const prompts_1 = require("@inquirer/prompts");
const core_1 = require("@oclif/core");
const chalk_1 = tslib_1.__importDefault(require("chalk"));
const constants_1 = require("../../constants");
const deploy_controller_1 = require("../../controller/deploy-controller");
const utils_1 = require("../../utils");
class Deploy extends core_1.Command {
    static description = 'Deployment to hosted service';
    static flags = {
        ...deploy_controller_1.DefaultDeployFlags,
        ipfsCID: core_1.Flags.string({ description: 'Enter IPFS CID' }),
        endpoint: core_1.Flags.string({ description: 'Enter endpoint', required: true }),
    };
    async run() {
        const { flags } = await this.parse(Deploy);
        const authToken = await (0, utils_1.checkToken)();
        flags.org = await (0, utils_1.valueOrPrompt)(flags.org, 'Enter organisation', 'Organisation is required');
        flags.projectName = await (0, utils_1.valueOrPrompt)(flags.projectName, 'Enter project name', 'Project name is required');
        flags.ipfsCID = await (0, utils_1.valueOrPrompt)(flags.ipfsCID, 'Enter IPFS CID', 'IPFS CID is required');
        const validator = await (0, deploy_controller_1.ipfsCID_validate)(flags.ipfsCID, authToken, constants_1.ROOT_API_URL_PROD);
        flags.queryVersion = (0, utils_1.addV)(flags.queryVersion);
        flags.indexerVersion = (0, utils_1.addV)(flags.indexerVersion);
        if (!validator.valid) {
            throw new Error(chalk_1.default.bgRedBright('Invalid IPFS CID'));
        }
        if (!flags.endpoint) {
            if (flags.useDefaults) {
                throw new Error(chalk_1.default.red('Please ensure a valid is passed using --endpoint flag'));
            }
            flags.endpoint = await (0, prompts_1.input)({ message: 'Enter endpoint', required: true });
        }
        if (!flags.indexerVersion) {
            (0, assert_1.default)(validator.manifestRunner, 'Please set manifestRunner in your project');
            try {
                flags.indexerVersion = await promptImageVersion(validator.manifestRunner.node.name, validator.manifestRunner.node.version, flags.useDefaults, authToken, 'Enter indexer version');
            }
            catch (e) {
                throw new Error(chalk_1.default.bgRedBright('Indexer version is required'));
            }
        }
        if (!flags.queryVersion) {
            (0, assert_1.default)(validator.manifestRunner, 'Please set manifestRunner in your project');
            try {
                flags.queryVersion = await promptImageVersion(validator.manifestRunner.query.name, validator.manifestRunner.query.version, flags.useDefaults, authToken, 'Enter query version');
            }
            catch (e) {
                throw new Error(chalk_1.default.bgRedBright('Query version is required'));
            }
        }
        const projectInfo = await (0, deploy_controller_1.projectsInfo)(authToken, flags.org, flags.projectName, constants_1.ROOT_API_URL_PROD, flags.type);
        const chains = [];
        chains.push((0, deploy_controller_1.generateDeploymentChain)({
            cid: flags.ipfsCID,
            dictEndpoint: flags.dict,
            endpoint: (0, deploy_controller_1.splitEndpoints)(flags.endpoint),
            flags: flags,
            indexerImageVersion: flags.indexerVersion,
        }));
        this.log('Deploying SubQuery project to Hosted Service');
        await (0, deploy_controller_1.executeProjectDeployment)({
            log: this.log.bind(this),
            authToken,
            chains,
            flags,
            ipfsCID: flags.ipfsCID,
            org: flags.org,
            projectInfo,
            projectName: flags.projectName,
            queryVersion: flags.queryVersion,
        });
    }
}
exports.default = Deploy;
async function promptImageVersion(runner, version, useDefaults, authToken, message) {
    const versions = await (0, deploy_controller_1.imageVersions)(runner, version, authToken, constants_1.ROOT_API_URL_PROD);
    if (!useDefaults) {
        return (0, prompts_1.select)({
            message,
            choices: versions.map((v) => ({ value: v })),
        });
    }
    else {
        return versions[0];
    }
}
//# sourceMappingURL=deploy.js.map