"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.subgraphValidation = subgraphValidation;
exports.readSubgraphManifest = readSubgraphManifest;
exports.extractNetworkFromManifest = extractNetworkFromManifest;
exports.renderManifest = renderManifest;
exports.migrateManifest = migrateManifest;
exports.subgraphTemplateToSubqlTemplate = subgraphTemplateToSubqlTemplate;
exports.subgraphDsToSubqlDs = subgraphDsToSubqlDs;
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importDefault(require("fs"));
const path_1 = tslib_1.__importDefault(require("path"));
const lodash_1 = require("lodash");
const yaml_1 = tslib_1.__importDefault(require("yaml"));
const utils_1 = require("../../../utils");
const constants_1 = require("../constants");
const migrate_controller_1 = require("../migrate-controller");
const PROJECT_TEMPLATE_PATH = path_1.default.resolve(__dirname, '../../../template/project.ts.ejs');
function unsupportedError(name) {
    throw new Error(`Unfortunately migration does not support option "${name}" from subgraph, please remove or find alternative solutions`);
}
// validate supported subgraph features
function subgraphValidation(subgraphProject) {
    if (subgraphProject.features)
        unsupportedError(`features`);
    if (subgraphProject.graft)
        unsupportedError(`graft`);
    if (subgraphProject.dataSources.find((ds) => ds.context)) {
        unsupportedError(`features`);
    }
}
function readSubgraphManifest(inputPath, subgraphPath) {
    try {
        const subgraphManifest = yaml_1.default.parse(fs_1.default.readFileSync(inputPath, 'utf8'));
        return subgraphManifest;
    }
    catch (e) {
        if (e.code === 'ENOENT') {
            throw new Error(`Unable to find subgraph manifest under: ${subgraphPath}`);
        }
        throw e;
    }
}
function extractNetworkFromManifest(subgraphProject) {
    const subgraphDsKinds = subgraphProject.dataSources.map((d) => d.kind).filter((k) => k !== undefined);
    const subgraphDsNetworks = subgraphProject.dataSources.map((d) => d.network).filter((n) => n !== undefined);
    if (!subgraphDsKinds.length || !subgraphDsNetworks.length) {
        throw new Error(`Subgraph dataSource kind or network not been found`);
    }
    if (!subgraphDsNetworks.every((network) => network === subgraphDsNetworks[0])) {
        throw new Error(`All network values in subgraph Networks should be the same. Got ${subgraphDsNetworks}`);
    }
    const firstDsKind = subgraphDsKinds[0];
    const firstDsNetwork = subgraphDsNetworks[0];
    const networkFamily = constants_1.graphToSubqlNetworkFamily[firstDsKind];
    if (!networkFamily) {
        throw new Error(`Corresponding SubQuery network is not found with subgraph data source kind ${firstDsKind}`);
    }
    return { networkFamily, chainId: (0, migrate_controller_1.getChainIdByNetworkName)(networkFamily, firstDsNetwork) };
}
/**
 * Render subquery project to .ts file
 * @param projectPath
 * @param project
 */
async function renderManifest(projectPath, project) {
    try {
        await (0, utils_1.renderTemplate)(PROJECT_TEMPLATE_PATH, projectPath, {
            props: {
                importTypes: {
                    network: 'ethereum',
                    projectClass: 'EthereumProject',
                    projectDatasourceKind: 'EthereumDatasourceKind',
                    projectHandlerKind: 'EthereumHandlerKind',
                },
                projectJson: project,
            },
            helper: {
                upperFirst: lodash_1.upperFirst,
            },
        });
    }
    catch (e) {
        throw new Error(`Failed to create project manifest, ${e}`);
    }
}
/**
 *  Migrate a subgraph project manifest to subquery manifest file
 * @param network network family
 * @param inputPath file path to subgraph.yaml
 * @param outputPath file path to project.ts
 */
async function migrateManifest(chainInfo, subgraphManifest, outputPath) {
    await (0, utils_1.prepareDirPath)(outputPath, false);
    await renderManifest(outputPath, graphManifestToSubqlManifest(chainInfo, subgraphManifest));
}
/**
 * Convert the graph project to subquery project
 * @param network
 * @param subgraphManifest
 */
function graphManifestToSubqlManifest(chainInfo, subgraphManifest) {
    const networkConverter = constants_1.networkConverters[chainInfo.networkFamily];
    if (!networkConverter || !networkConverter.templateConverter || !networkConverter.dsConverter) {
        throw new Error(`${chainInfo.networkFamily} is missing datasource/template convert methods for migration.`);
    }
    return {
        network: { chainId: chainInfo.chainId, endpoint: '' },
        name: subgraphManifest.name,
        specVersion: '1.0.0',
        runner: {
            node: { version: '^', name: (0, utils_1.findRunnerByNetworkFamily)(chainInfo.networkFamily) },
            query: { version: '^', name: '@subql/query' },
        },
        version: subgraphManifest.specVersion,
        dataSources: subgraphDsToSubqlDs(networkConverter.dsConverter, subgraphManifest.dataSources),
        description: subgraphManifest.description,
        schema: subgraphManifest.schema,
        repository: '',
        templates: subgraphManifest.templates
            ? subgraphTemplateToSubqlTemplate(networkConverter.templateConverter, subgraphManifest.templates)
            : undefined,
    };
}
function subgraphTemplateToSubqlTemplate(convertFunction, subgraphTemplates) {
    return subgraphTemplates.map((t) => convertFunction(t));
}
function subgraphDsToSubqlDs(convertFunction, subgraphDs) {
    return subgraphDs.map((ds) => convertFunction(ds));
}
//# sourceMappingURL=migrate-manifest.controller.js.map