"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const assert_1 = tslib_1.__importDefault(require("assert"));
const core_1 = require("@oclif/core");
const constants_1 = require("../../constants");
const project_controller_1 = require("../../controller/project-controller");
const utils_1 = require("../../utils");
class Create_project extends core_1.Command {
    static description = 'Create Project on Hosted Service';
    static flags = {
        org: core_1.Flags.string({ description: 'Enter organization name' }),
        projectName: core_1.Flags.string({ description: 'Enter project name' }),
        logoURL: core_1.Flags.string({ description: 'Enter logo URL', default: '', required: false }),
        subtitle: core_1.Flags.string({ description: 'Enter subtitle', default: '', required: false }),
        description: core_1.Flags.string({ description: 'Enter description', default: '', required: false }),
        dedicatedDB: core_1.Flags.string({ description: 'Enter dedicated DataBase', required: false }),
        projectType: core_1.Flags.string({
            description: 'Enter project type [subquery|subgraph]',
            default: 'subquery',
            required: false,
        }),
    };
    async run() {
        const { flags } = await this.parse(Create_project);
        let { org, projectName } = flags;
        (0, assert_1.default)(['subquery'].includes(flags.projectType), 'Invalid project type, only "subquery" is supported. Please deploy Subgraphs through the website.');
        const authToken = await (0, utils_1.checkToken)();
        org = await (0, utils_1.valueOrPrompt)(org, 'Enter organisation', 'Organisation is required');
        projectName = await (0, utils_1.valueOrPrompt)(projectName, 'Enter project name', 'Project name is required');
        const result = await (0, project_controller_1.createProject)(constants_1.ROOT_API_URL_PROD, authToken, {
            apiVersion: 'v3',
            description: flags.description,
            key: `${org}/${projectName}`,
            logoUrl: flags.logoURL,
            name: projectName,
            subtitle: flags.subtitle,
            dedicateDBKey: flags.dedicatedDB,
            tag: [],
            type: flags.projectType === 'subquery' ? 1 : 3,
        }).catch((e) => this.error(e));
        const [account, name] = result.key.split('/');
        this.log(`Successfully created project: ${result.key}
    \nProject Url: ${constants_1.BASE_PROJECT_URL}/orgs/${account}/projects/${name}/deployments`);
    }
}
exports.default = Create_project;
//# sourceMappingURL=create-project.js.map