"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractGitInfo = extractGitInfo;
exports.improveProjectInfo = improveProjectInfo;
exports.prepareProject = prepareProject;
exports.getChainIdByNetworkName = getChainIdByNetworkName;
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importDefault(require("fs"));
const path_1 = tslib_1.__importDefault(require("path"));
const common_1 = require("@subql/common");
const init_controller_1 = require("../init-controller");
const constants_1 = require("./constants");
/**
 *
 * @param input is github link or ssh, or bitbucket link
 * return undefined if link not match any
 */
const githubLinkRegex = /^https:\/\/github\.com\/(?<domain>[^/]+)\/(?<repository>[^/]+)(?:\/tree\/(?<branch>[^/]+))?/;
const bitbucketLinkRegex = /^https:\/\/(?:[^/]+@)?bitbucket\.org\/(?<domain>[^/]+)\/(?<repository>[^/]+)(?:\/src\/(?<branch>[^/]+))?/;
const sshRegex = /^git@(?:bitbucket\.org|github\.com):[^/]+\/(?<repository>[^/]+)\.git$/;
function extractGitInfo(input) {
    const gitLinkMatch = input.match(githubLinkRegex);
    const bitBucketLinkMatch = input.match(bitbucketLinkRegex);
    const sshMatch = input.match(sshRegex);
    if (!gitLinkMatch && !sshMatch && !bitBucketLinkMatch) {
        return undefined;
    }
    const { branch, domain, repository } = gitLinkMatch?.groups || bitBucketLinkMatch?.groups || {};
    const link = sshMatch
        ? input
        : `https:${gitLinkMatch ? `//github.com` : bitBucketLinkMatch ? `//bitbucket.org` : undefined}/${domain}/${repository}`;
    return { link, branch };
}
// improve project info from the graph package json
function improveProjectInfo(subgraphDir, subgraphManifest) {
    const packageData = fs_1.default.readFileSync(`${subgraphDir}/package.json`);
    const thegraphPackage = JSON.parse(packageData.toString());
    subgraphManifest.name = thegraphPackage.name.replace('subgraph', 'subquery');
    subgraphManifest.author = thegraphPackage.author;
    subgraphManifest.description = subgraphManifest.description ?? thegraphPackage.description;
    subgraphManifest.repository = '';
}
// Pull a network starter, as base project. Then mapping, manifest, schema can be overridden, copy over abi files
async function prepareProject(chainInfo, subqlDir) {
    const exampleProjects = await (0, init_controller_1.fetchExampleProjects)(networkFamilyToTemplateNetwork(chainInfo.networkFamily), chainInfo.chainId);
    const templateProject = exampleProjects.find((p) => p.name.includes('-starter'));
    if (!templateProject) {
        throw new Error(`Could not find subquery template for network ${chainInfo.networkFamily} chain ${chainInfo.chainId}`);
    }
    await (0, init_controller_1.cloneProjectTemplate)(path_1.default.parse(subqlDir).dir, path_1.default.parse(subqlDir).name, templateProject);
}
//TODO, this might can be dynamic
function getChainIdByNetworkName(networkFamily, chainName) {
    const chainId = constants_1.graphNetworkNameChainId[networkFamily]?.[chainName];
    if (!chainId) {
        throw new Error(`Could not find chainId for network ${networkFamily} chain ${chainName}`);
    }
    return chainId;
}
function networkFamilyToTemplateNetwork(networkFamily) {
    switch (networkFamily) {
        case common_1.NETWORK_FAMILY.ethereum:
            return 'evm';
        default:
            // like polkadot/algorand
            return networkFamily.toLowerCase();
    }
}
//# sourceMappingURL=migrate-controller.js.map