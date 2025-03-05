"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildManifestFromLocation = buildManifestFromLocation;
exports.generateManifestFromTs = generateManifestFromTs;
exports.getTsManifest = getTsManifest;
const tslib_1 = require("tslib");
const assert_1 = tslib_1.__importDefault(require("assert"));
const fs_1 = require("fs");
const path_1 = tslib_1.__importDefault(require("path"));
const common_1 = require("@subql/common");
const yaml = tslib_1.__importStar(require("js-yaml"));
const tsNode = tslib_1.__importStar(require("ts-node"));
const utils_1 = require("./utils");
const requireScriptWrapper = (scriptPath, outputPath) => `import {toJsonObject} from '@subql/common';` +
    `const {writeFileSync} = require('fs');` +
    `const yaml = require('js-yaml');` +
    `const project = toJsonObject((require('${scriptPath}')).default);` +
    `const yamlOutput = yaml.dump(project);` +
    `writeFileSync('${outputPath}', '# // Auto-generated , DO NOT EDIT\\n' + yamlOutput);`;
// Replaces \ in path on windows that don't work with require
function formatPath(p) {
    return p.replace(/\\/g, '/');
}
async function buildManifestFromLocation(location, log) {
    let directory;
    let projectManifestEntry;
    // lstatSync will throw if location not exist
    if ((0, fs_1.lstatSync)(location).isDirectory()) {
        directory = location;
        projectManifestEntry = path_1.default.join(directory, common_1.DEFAULT_TS_MANIFEST);
    }
    else if ((0, fs_1.lstatSync)(location).isFile()) {
        directory = path_1.default.dirname(location);
        projectManifestEntry = location;
    }
    else {
        throw new Error('Argument `location` is not a valid directory or file');
    }
    // We compile from TypeScript every time, even if the current YAML file exists, to ensure that the YAML file remains up-to-date with the latest changes
    try {
        //we could have a multichain yaml with ts projects inside it
        const projectYamlPath = projectManifestEntry.endsWith('.ts')
            ? await generateManifestFromTs(projectManifestEntry, log)
            : projectManifestEntry;
        if ((0, utils_1.isMultichain)(projectYamlPath)) {
            const tsManifests = getTsManifestsFromMultichain(projectYamlPath);
            await Promise.all(tsManifests.map((manifest) => generateManifestFromTs(manifest, log)));
            replaceTsReferencesInMultichain(projectYamlPath);
        }
    }
    catch (e) {
        console.log(e);
        throw new Error(`Failed to generate manifest from typescript ${projectManifestEntry}, ${e.message}`);
    }
    return directory;
}
// eslint-disable-next-line @typescript-eslint/require-await
async function generateManifestFromTs(projectManifestEntry, log) {
    (0, assert_1.default)((0, fs_1.existsSync)(projectManifestEntry), `${projectManifestEntry} does not exist`);
    const projectYamlPath = (0, common_1.tsProjectYamlPath)(projectManifestEntry);
    try {
        // Allows requiring TS, this allows requirng the projectManifestEntry ts file
        const tsNodeService = tsNode.register({ transpileOnly: true });
        // Compile the above script
        const script = tsNodeService.compile(requireScriptWrapper(formatPath(projectManifestEntry), formatPath(projectYamlPath)), 'inline.ts');
        // Run compiled code
        eval(script);
        log(`Project manifest generated to ${projectYamlPath}`);
        return projectYamlPath;
    }
    catch (error) {
        throw new Error(`Failed to build ${projectManifestEntry}: ${error}`);
    }
}
//Returns either the single chain ts manifest or the multichain ts/yaml manifest
function getTsManifest(location) {
    let manifest;
    if ((0, fs_1.lstatSync)(location).isDirectory()) {
        //default ts manifest
        manifest = path_1.default.join(location, common_1.DEFAULT_TS_MANIFEST);
        if ((0, fs_1.existsSync)(manifest)) {
            return manifest;
        }
        else {
            //default multichain ts manifest
            manifest = path_1.default.join(location, common_1.DEFAULT_MULTICHAIN_TS_MANIFEST);
            if ((0, fs_1.existsSync)(manifest)) {
                return manifest;
            }
            else {
                //default yaml multichain manifest
                manifest = path_1.default.join(location, common_1.DEFAULT_MULTICHAIN_MANIFEST);
                if ((0, fs_1.existsSync)(manifest)) {
                    return manifest;
                }
            }
        }
    }
    else if ((0, fs_1.lstatSync)(location).isFile()) {
        if (location.endsWith('.ts') || (0, utils_1.isMultichain)(location)) {
            return location;
        }
    }
    return null;
}
function getTsManifestsFromMultichain(location) {
    const multichainContent = yaml.load((0, fs_1.readFileSync)(location, 'utf8'));
    if (!multichainContent || !multichainContent.projects) {
        return [];
    }
    return multichainContent.projects
        .filter((project) => project.endsWith('.ts'))
        .map((project) => path_1.default.resolve(path_1.default.dirname(location), project));
}
function replaceTsReferencesInMultichain(location) {
    const multichainContent = yaml.load((0, fs_1.readFileSync)(location, 'utf8'));
    multichainContent.projects = multichainContent.projects.map((project) => (0, common_1.tsProjectYamlPath)(project));
    const yamlOutput = yaml.dump(multichainContent);
    (0, fs_1.writeFileSync)(location, yamlOutput);
}
//# sourceMappingURL=build.js.map