"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@oclif/core");
const constants_1 = require("../../constants");
const deploy_controller_1 = require("../../controller/deploy-controller");
const utils_1 = require("../../utils");
class Delete extends core_1.Command {
    static description = 'Delete Deployment';
    static flags = {
        org: core_1.Flags.string({ description: 'Enter organization name' }),
        project_name: core_1.Flags.string({ description: 'Enter project name' }),
        deploymentID: core_1.Flags.string({ description: 'Enter deployment ID' }),
    };
    async run() {
        const { flags } = await this.parse(Delete);
        const authToken = await (0, utils_1.checkToken)();
        const org = await (0, utils_1.valueOrPrompt)(flags.org, 'Enter organisation', 'Organisation is required');
        const project_name = await (0, utils_1.valueOrPrompt)(flags.project_name, 'Enter project name', 'Project name is required');
        const deploymentID = +(await (0, utils_1.valueOrPrompt)(flags.deploymentID, 'Enter deployment ID', 'Deployment ID is required'));
        this.log(`Removing deployment: ${deploymentID}`);
        const delete_output = await (0, deploy_controller_1.deleteDeployment)(org, project_name, authToken, +deploymentID, constants_1.ROOT_API_URL_PROD).catch((e) => this.error(e));
        this.log(`Removed deployment: ${delete_output}`);
    }
}
exports.default = Delete;
//# sourceMappingURL=delete.js.map