"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const prompts_1 = require("@inquirer/prompts");
const core_1 = require("@oclif/core");
const create_project_1 = tslib_1.__importDefault(require("./create-project"));
const delete_project_1 = tslib_1.__importDefault(require("./delete-project"));
class Project extends core_1.Command {
    static description = 'Create/Delete project';
    static flags = {
        options: core_1.Flags.string({
            options: ['create', 'delete'],
        }),
        ...delete_project_1.default.flags,
        ...create_project_1.default.flags,
    };
    static optionMapping = {
        create: create_project_1.default,
        delete: delete_project_1.default,
    };
    async run() {
        const { flags } = await this.parse(Project);
        const option = flags.options;
        let userOptions;
        if (!option) {
            userOptions = await (0, prompts_1.select)({
                message: 'Select a project option',
                choices: [{ value: 'create' }, { value: 'delete' }],
            });
        }
        else {
            userOptions = option;
        }
        this.log(`Selected project option: ${userOptions}`);
        try {
            const handler = Project.optionMapping[userOptions];
            // removes arguments -> deployment and everything before it from the process.argv
            const stripped_argv = process.argv
                .filter((v, idx) => idx > process.argv.indexOf('project') && !v.includes('--options'))
                .reduce((acc, val) => acc.concat(val.split('=')), []);
            await handler.run(stripped_argv);
        }
        catch (e) {
            this.log(`Failed to execute command: ${userOptions} error: ${e}`);
        }
    }
}
exports.default = Project;
//# sourceMappingURL=index.js.map