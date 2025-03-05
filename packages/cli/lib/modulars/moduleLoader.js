"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadDependency = loadDependency;
const tslib_1 = require("tslib");
const fs_1 = require("fs");
const path_1 = tslib_1.__importDefault(require("path"));
const config_1 = require("./config");
const moduleCache = {};
function loadDependency(network) {
    const packageName = config_1.networkPackages[network];
    if (!packageName) {
        throw new Error(`Unknown network: ${network}`);
    }
    if (!moduleCache[network]) {
        try {
            moduleCache[network] = require(packageName);
        }
        catch (error) {
            console.warn(`! Failed to load ${packageName} locally: ${error}. \n ! Attempting to load globally`);
            try {
                const globalNodePath = process.env.NODE_PATH;
                if (!globalNodePath) {
                    throw new Error(`If you have installed ${packageName} globally please set the NODE_PATH environment variable. Follow this document for more details: https://nodejs.org/api/modules.html#loading-from-the-global-folders`);
                }
                const globalModulePath = path_1.default.join(globalNodePath, packageName);
                if ((0, fs_1.existsSync)(globalModulePath)) {
                    moduleCache[network] = require(globalModulePath);
                }
                else {
                    throw new Error(`Global module ${packageName} not found, please run "npm i -g ${packageName}" and retry`);
                }
            }
            catch (globalError) {
                throw new Error(`! Failed to load dependency globally: ${packageName}`, { cause: globalError });
            }
        }
    }
    // Check dependencies actually satisfy INetworkCommonModule
    const loadedModule = moduleCache[network];
    if (loadedModule?.parseProjectManifest === undefined ||
        loadedModule?.isCustomDs === undefined ||
        loadedModule?.isRuntimeDs === undefined) {
        throw new Error(`${packageName} is not compatible, please make sure package update to latest version`);
    }
    return loadedModule;
}
//# sourceMappingURL=moduleLoader.js.map