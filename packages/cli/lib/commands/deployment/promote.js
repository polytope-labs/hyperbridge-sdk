"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@oclif/core");
const constants_1 = require("../../constants");
const deploy_controller_1 = require("../../controller/deploy-controller");
const utils_1 = require("../../utils");
class Promote extends core_1.Command {
    static description = 'Promote Deployment';
    static flags = {
        org: core_1.Flags.string({ description: 'Enter organization name' }),
        project_name: core_1.Flags.string({ description: 'Enter project name' }),
        deploymentID: core_1.Flags.string({ description: 'Enter deployment ID' }),
    };
    async run() {
        const { flags } = await this.parse(Promote);
        const authToken = await (0, utils_1.checkToken)();
        const deploymentID = +(await (0, utils_1.valueOrPrompt)(flags.deploymentID, 'Enter deployment ID', 'Deployment ID is required'));
        const org = await (0, utils_1.valueOrPrompt)(flags.org, 'Enter organisation', 'Organisation is required');
        const project_name = await (0, utils_1.valueOrPrompt)(flags.project_name, 'Enter project name', 'Project name is required');
        const promote_output = await (0, deploy_controller_1.promoteDeployment)(org, project_name, authToken, +deploymentID, constants_1.ROOT_API_URL_PROD).catch((e) => this.error(e));
        this.log(`Promote deployment: ${promote_output} from Stage to Production`);
    }
}
exports.default = Promote;
//# sourceMappingURL=promote.js.map