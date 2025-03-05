"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const prompts_1 = require("@inquirer/prompts");
const core_1 = require("@oclif/core");
const delete_1 = tslib_1.__importDefault(require("./delete"));
const deploy_1 = tslib_1.__importDefault(require("./deploy"));
const promote_1 = tslib_1.__importDefault(require("./promote"));
class Deployment extends core_1.Command {
    static description = 'Deploy to hosted service';
    static flags = {
        options: core_1.Flags.string({
            options: ['deploy', 'promote', 'delete'],
        }),
        ...deploy_1.default.flags,
        ...promote_1.default.flags,
        ...delete_1.default.flags,
    };
    static optionMapping = {
        deploy: deploy_1.default,
        promote: promote_1.default,
        delete: delete_1.default,
    };
    async run() {
        const { flags } = await this.parse(Deployment);
        const option = flags.options;
        let userOptions;
        if (!option) {
            userOptions = await (0, prompts_1.select)({
                message: 'Select a deployment option',
                choices: [{ value: 'deploy' }, { value: 'promote' }, { value: 'delete' }],
            });
        }
        else {
            userOptions = option;
        }
        this.log(`Selected deployment option: ${userOptions}`);
        try {
            const handler = Deployment.optionMapping[userOptions];
            // removes arguments -> deployment and everything before it from the process.argv
            const stripped_argv = process.argv
                .filter((v, idx) => idx > process.argv.indexOf('deployment') && !v.includes('--options'))
                .reduce((acc, val) => acc.concat(val.split('=')), []);
            await handler.run(stripped_argv);
        }
        catch (e) {
            this.log(`Failed to execute command: ${userOptions} error: ${e}`);
        }
    }
}
exports.default = Deployment;
//# sourceMappingURL=index.js.map