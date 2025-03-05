"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@oclif/core");
const constants_1 = require("../../constants");
const project_controller_1 = require("../../controller/project-controller");
const utils_1 = require("../../utils");
class Delete_project extends core_1.Command {
    static description = 'Delete Project on Hosted Service';
    static flags = {
        org: core_1.Flags.string({ description: 'Enter organization name' }),
        projectName: core_1.Flags.string({ description: 'Enter project name' }),
    };
    async run() {
        const { flags } = await this.parse(Delete_project);
        const authToken = await (0, utils_1.checkToken)();
        let { org, projectName } = flags;
        org = await (0, utils_1.valueOrPrompt)(org, 'Enter organisation', 'Organisation is required');
        projectName = await (0, utils_1.valueOrPrompt)(projectName, 'Enter project name', 'Project name is required');
        const deleteStatus = await (0, project_controller_1.deleteProject)(authToken, org, projectName, constants_1.ROOT_API_URL_PROD).catch((e) => this.error(e));
        this.log(`Project: ${deleteStatus} has been deleted`);
    }
}
exports.default = Delete_project;
//# sourceMappingURL=delete-project.js.map