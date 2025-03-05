"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const assert_1 = tslib_1.__importDefault(require("assert"));
const fs_1 = tslib_1.__importStar(require("fs"));
const path_1 = tslib_1.__importDefault(require("path"));
const prompts_1 = require("@inquirer/prompts");
const core_1 = require("@oclif/core");
const common_1 = require("@subql/common");
const simple_git_1 = tslib_1.__importDefault(require("simple-git"));
const constants_1 = require("../constants");
const init_controller_1 = require("../controller/init-controller");
const migrate_1 = require("../controller/migrate");
const migrate_mapping_controller_1 = require("../controller/migrate/mapping/migrate-mapping.controller");
class Migrate extends core_1.Command {
    static description = 'Schema subgraph project to subquery project';
    static flags = {
        gitSubDirectory: core_1.Flags.string({ char: 'd', description: 'specify git subdirectory path' }),
        file: core_1.Flags.string({ char: 'f', description: 'specify subgraph git/directory path' }),
        output: core_1.Flags.string({ char: 'o', description: 'Output subquery project path', required: false }),
    };
    async run() {
        const { flags } = await this.parse(Migrate);
        const { file, gitSubDirectory, output } = flags;
        const subgraphPath = file ?? (await (0, prompts_1.input)({ message: 'Subgraph project path, local or git', required: true }));
        const subqlPath = output ?? (await (0, prompts_1.input)({ message: 'SubQuery project path, local or git', required: true }));
        const gitMatch = (0, migrate_1.extractGitInfo)(subgraphPath);
        // will return false if directory not exist
        const direMatch = (0, fs_1.lstatSync)(subgraphPath, { throwIfNoEntry: false })?.isDirectory() ?? false;
        const parsedSubqlPath = path_1.default.parse(subqlPath);
        // We don't need to check output directory is existing or not
        const subqlDir = parsedSubqlPath.ext === '' ? subqlPath : parsedSubqlPath.dir;
        let subgraphDir;
        let tempSubgraphDir;
        if (gitMatch) {
            tempSubgraphDir = await (0, common_1.makeTempDir)();
            const { branch, link } = gitMatch;
            // clone the subdirectory project
            if (gitSubDirectory) {
                subgraphDir = path_1.default.join(tempSubgraphDir, gitSubDirectory);
                await (0, simple_git_1.default)(tempSubgraphDir).init().addRemote('origin', link);
                await (0, simple_git_1.default)(tempSubgraphDir).raw('sparse-checkout', 'set', `${gitSubDirectory}`);
                (0, assert_1.default)(branch, 'Branch is required for git subdirectory');
                await (0, simple_git_1.default)(tempSubgraphDir).raw('pull', 'origin', branch);
            }
            else {
                subgraphDir = tempSubgraphDir;
                await (0, simple_git_1.default)().clone(link, subgraphDir, branch ? ['-b', branch, '--single-branch'] : ['--single-branch']);
            }
            console.log(`* Pull subgraph project from git: ${link}, branch: ${branch ?? 'default branch'}${gitSubDirectory ? `, subdirectory:${gitSubDirectory}` : '.'}`);
        }
        else if (direMatch) {
            if (gitSubDirectory) {
                this.error(`Git sub directory only works with git path, not local directories.`);
            }
            subgraphDir = subgraphPath;
        }
        else {
            this.error(`Subgraph project should be a git ssh/link or file directory`);
        }
        const subgraphManifestPath = path_1.default.join(subgraphDir, constants_1.DEFAULT_SUBGRAPH_MANIFEST);
        const subgraphSchemaPath = path_1.default.join(subgraphDir, constants_1.DEFAULT_SUBGRAPH_SCHEMA);
        const subqlManifestPath = path_1.default.join(subqlDir, constants_1.DEFAULT_SUBQL_MANIFEST);
        const subqlSchemaPath = path_1.default.join(subqlDir, constants_1.DEFAULT_SUBQL_SCHEMA);
        try {
            const subgraphManifest = (0, migrate_1.readSubgraphManifest)(subgraphManifestPath, subgraphPath);
            (0, migrate_1.improveProjectInfo)(subgraphDir, subgraphManifest);
            (0, migrate_1.subgraphValidation)(subgraphManifest);
            const chainInfo = (0, migrate_1.extractNetworkFromManifest)(subgraphManifest);
            await (0, migrate_1.prepareProject)(chainInfo, subqlDir);
            await (0, migrate_1.migrateAbis)(subgraphManifest, subgraphDir, subqlDir);
            await (0, migrate_1.migrateManifest)(chainInfo, subgraphManifest, subqlManifestPath);
            // render package.json
            await (0, init_controller_1.preparePackage)(subqlDir, {
                name: subgraphManifest.name ?? '',
                description: subgraphManifest.description,
                author: subgraphManifest.author ?? '',
                endpoint: [],
            });
            await (0, migrate_1.migrateSchema)(subgraphSchemaPath, subqlSchemaPath);
            await (0, migrate_mapping_controller_1.migrateMapping)(subgraphDir, subqlDir);
            this.log(`* Output migrated SubQuery project to ${subqlDir}`);
        }
        catch (e) {
            // Clean project folder, only remove temp dir project, if user provide local project DO NOT REMOVE
            if (tempSubgraphDir !== undefined) {
                fs_1.default.rmSync(tempSubgraphDir, { recursive: true, force: true });
            }
            fs_1.default.rmSync(subqlDir, { recursive: true, force: true });
            this.error(`Migrate project failed: ${e}`);
        }
    }
}
exports.default = Migrate;
//# sourceMappingURL=migrate.js.map