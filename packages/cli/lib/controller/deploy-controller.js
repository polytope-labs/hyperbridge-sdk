"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.DefaultDeployFlags = void 0;
exports.createDeployment = createDeployment;
exports.promoteDeployment = promoteDeployment;
exports.deleteDeployment = deleteDeployment;
exports.deploymentStatus = deploymentStatus;
exports.projectsInfo = projectsInfo;
exports.updateDeployment = updateDeployment;
exports.ipfsCID_validate = ipfsCID_validate;
exports.imageVersions = imageVersions;
exports.splitEndpoints = splitEndpoints;
exports.splitMultichainDataFields = splitMultichainDataFields;
exports.generateDeploymentChain = generateDeploymentChain;
exports.generateAdvancedQueryOptions = generateAdvancedQueryOptions;
exports.executeProjectDeployment = executeProjectDeployment;
const tslib_1 = require("tslib");
const assert_1 = tslib_1.__importDefault(require("assert"));
const core_1 = require("@oclif/core");
const axios_1 = tslib_1.__importDefault(require("axios"));
const chalk_1 = tslib_1.__importDefault(require("chalk"));
const constants_1 = require("../constants");
const utils_1 = require("../utils");
function getAxiosInstance(url, authToken) {
    const headers = {};
    if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
    }
    return axios_1.default.create({
        baseURL: url,
        headers,
    });
}
async function createDeployment(org, projectName, authToken, ipfsCID, queryImageVersion, type, query, chains, url) {
    try {
        const res = await getAxiosInstance(url, authToken).post(`v3/subqueries/${(0, utils_1.buildProjectKey)(org, projectName)}/deployments`, {
            cid: ipfsCID,
            type: type,
            queryImageVersion: queryImageVersion,
            queryAdvancedSettings: { query },
            chains,
        });
        return res.data.deployment;
    }
    catch (e) {
        throw (0, utils_1.errorHandle)(e, 'Error deploying to hosted service:');
    }
}
async function promoteDeployment(org, projectName, authToken, deploymentId, url) {
    try {
        await getAxiosInstance(url, authToken).post(`subqueries/${(0, utils_1.buildProjectKey)(org, projectName)}/deployments/${deploymentId}/release`);
        return `${deploymentId}`;
    }
    catch (e) {
        throw (0, utils_1.errorHandle)(e, 'Failed to promote project:');
    }
}
async function deleteDeployment(org, projectName, authToken, deploymentId, url) {
    try {
        await getAxiosInstance(url, authToken).delete(`subqueries/${(0, utils_1.buildProjectKey)(org, projectName)}/deployments/${deploymentId}`);
        return `${deploymentId}`;
    }
    catch (e) {
        throw (0, utils_1.errorHandle)(e, 'Failed to delete deployment:');
    }
}
async function deploymentStatus(org, projectName, authToken, deployID, url) {
    try {
        const res = await getAxiosInstance(url, authToken).get(`subqueries/${(0, utils_1.buildProjectKey)(org, projectName)}/deployments/${deployID}/status`);
        return `${res.data.status}`;
    }
    catch (e) {
        throw (0, utils_1.errorHandle)(e, 'Failed to get deployment status:');
    }
}
async function projectsInfo(authToken, org, projectName, url, type) {
    const key = `${org}/${projectName.toLowerCase()}`;
    try {
        const res = await getAxiosInstance(url, authToken).get(`v3/subqueries/${(0, utils_1.buildProjectKey)(org, projectName)}/deployments`);
        return res.data.find((element) => element.projectKey === `${key}` && element.type === type);
    }
    catch (e) {
        throw (0, utils_1.errorHandle)(e, 'Failed to get projects:');
    }
}
async function updateDeployment(org, projectName, deployID, authToken, ipfsCID, queryVersion, query, chains, url) {
    try {
        await getAxiosInstance(url, authToken).put(`v3/subqueries/${(0, utils_1.buildProjectKey)(org, projectName)}/deployments/${deployID}`, {
            cid: ipfsCID,
            queryImageVersion: queryVersion,
            queryAdvancedSettings: { query },
            chains,
        });
    }
    catch (e) {
        throw (0, utils_1.errorHandle)(e, `Failed to redeploy project: ${e.message}`);
    }
}
async function ipfsCID_validate(cid, authToken, url) {
    (0, assert_1.default)(cid, 'IPFS CID is required');
    try {
        const res = await getAxiosInstance(url, authToken).post(`ipfs/deployment-id/${cid}/validate`);
        if (res.status === 500) {
            throw new Error(res.data.message);
        }
        return res.data;
    }
    catch (e) {
        throw (0, utils_1.errorHandle)(e, 'Failed to validate IPFS CID:');
    }
}
async function imageVersions(name, version, authToken, url) {
    try {
        const res = await getAxiosInstance(url, authToken).get(`info/images/${encodeURIComponent(name)}?version=${encodeURIComponent(version)}`);
        return res.data;
    }
    catch (e) {
        throw (0, utils_1.errorHandle)(e, 'Failed to get image:');
    }
}
function splitEndpoints(endpointStr) {
    return endpointStr.split(',').map((e) => e.trim());
}
function splitMultichainDataFields(fieldStr = '') {
    const result = {};
    splitEndpoints(String(fieldStr)).forEach((unparsedRow) => {
        const regexpResult = unparsedRow.match(/(.*?):(.*)/);
        if (regexpResult) {
            const regexpRes = Object.values(regexpResult);
            if (regexpRes && regexpRes.length === 6 && ['http', 'https', 'ws', 'wss'].indexOf(regexpRes[1]) === -1) {
                result[regexpRes[1]] = regexpRes[2];
            }
        }
    });
    return result;
}
exports.DefaultDeployFlags = {
    org: core_1.Flags.string({ description: 'Enter organization name' }),
    projectName: core_1.Flags.string({ description: 'Enter project name' }),
    // ipfsCID: Flags.string({description: 'Enter IPFS CID'}),
    type: core_1.Flags.string({
        options: ['stage', 'primary'],
        default: constants_1.DEFAULT_DEPLOYMENT_TYPE,
        required: false,
    }),
    indexerVersion: core_1.Flags.string({ description: 'Enter indexer-version', required: false }),
    queryVersion: core_1.Flags.string({ description: 'Enter query-version', required: false }),
    dict: core_1.Flags.string({ description: 'Enter dictionary', required: false }),
    endpoint: core_1.Flags.string({ description: 'Enter endpoint', required: false }),
    //indexer set up flags
    indexerUnsafe: core_1.Flags.boolean({ description: 'Enable indexer unsafe', required: false }),
    indexerBatchSize: core_1.Flags.integer({ description: 'Enter batchSize from 1 to 30', required: false }),
    indexerSubscription: core_1.Flags.boolean({ description: 'Enable Indexer subscription', required: false }),
    disableHistorical: core_1.Flags.boolean({ description: 'Disable Historical Data', required: false }),
    indexerUnfinalized: core_1.Flags.boolean({
        description: 'Index unfinalized blocks (requires Historical to be enabled)',
        required: false,
    }),
    indexerStoreCacheThreshold: core_1.Flags.integer({
        description: 'The number of items kept in the cache before flushing',
        required: false,
    }),
    disableIndexerStoreCacheAsync: core_1.Flags.boolean({
        description: 'If enabled the store cache will flush data asynchronously relative to indexing data.',
        required: false,
    }),
    indexerWorkers: core_1.Flags.integer({ description: 'Enter worker threads from 1 to 5', required: false, max: 5 }),
    //query flags
    queryUnsafe: core_1.Flags.boolean({ description: 'Enable indexer unsafe', required: false }),
    querySubscription: core_1.Flags.boolean({ description: 'Enable Query subscription', required: false }),
    queryTimeout: core_1.Flags.integer({ description: 'Enter timeout from 1000ms to 60000ms', required: false }),
    queryMaxConnection: core_1.Flags.integer({ description: 'Enter MaxConnection from 1 to 10', required: false }),
    queryAggregate: core_1.Flags.boolean({ description: 'Enable Aggregate', required: false }),
    queryLimit: core_1.Flags.integer({ description: 'Set the max number of results the query service returns', required: false }),
    useDefaults: core_1.Flags.boolean({
        char: 'd',
        description: 'Use default values for indexerVersion, queryVersion, dictionary, endpoint',
        required: false,
    }),
};
function generateDeploymentChain(row) {
    return {
        cid: row.cid,
        dictEndpoint: row.dictEndpoint,
        endpoint: row.endpoint,
        indexerImageVersion: row.indexerImageVersion,
        indexerAdvancedSettings: {
            indexer: {
                unsafe: row.flags.indexerUnsafe,
                batchSize: row.flags.indexerBatchSize,
                subscription: row.flags.indexerSubscription,
                historicalData: !row.flags.disableHistorical,
                unfinalizedBlocks: row.flags.indexerUnfinalized,
                storeCacheThreshold: row.flags.indexerStoreCacheThreshold,
                disableStoreCacheAsync: row.flags.disableIndexerStoreCacheAsync,
            },
        },
        extraParams: row.flags.indexerWorkers
            ? {
                workers: {
                    num: row.flags.indexerWorkers,
                },
            }
            : {},
    };
}
function generateAdvancedQueryOptions(flags) {
    return {
        unsafe: !!flags.queryUnsafe,
        subscription: !!flags.querySubscription,
        queryTimeout: Number(flags.queryTimeout),
        queryLimit: flags.queryLimit ? Number(flags.queryLimit) : undefined,
        // maxConnection: Number(flags.queryMaxConnection), // project version or plan does not support maxConnection
        aggregate: !!flags.queryAggregate,
    };
}
async function executeProjectDeployment(data) {
    if (data.projectInfo !== undefined) {
        await updateDeployment(data.org, data.projectName, data.projectInfo.id, data.authToken, data.ipfsCID, data.queryVersion, generateAdvancedQueryOptions(data.flags), data.chains, constants_1.ROOT_API_URL_PROD);
        data.log(`Project: ${data.projectName} has been re-deployed`);
    }
    else {
        const deploymentOutput = await createDeployment(data.org, data.projectName, data.authToken, data.ipfsCID, data.queryVersion, data.flags.type, generateAdvancedQueryOptions(data.flags), data.chains, constants_1.ROOT_API_URL_PROD);
        if (deploymentOutput) {
            data.log(`Project: ${deploymentOutput.projectKey}
Status: ${chalk_1.default.blue(deploymentOutput.status)}
DeploymentID: ${deploymentOutput.id}
Deployment Type: ${deploymentOutput.type}
Indexer version: ${deploymentOutput.indexerImage}
Query version: ${deploymentOutput.queryImage}
Endpoint: ${deploymentOutput.endpoint}
Dictionary Endpoint: ${deploymentOutput.dictEndpoint}
Query URL: ${deploymentOutput.queryUrl}
Project URL: ${constants_1.BASE_PROJECT_URL}/org/${data.org}/project/${data.projectName}
Advanced Settings for Query: ${JSON.stringify(deploymentOutput.configuration.config.query)}
Advanced Settings for Indexer: ${JSON.stringify(deploymentOutput.configuration.config.indexer)}
      `);
        }
        return deploymentOutput;
    }
}
//# sourceMappingURL=deploy-controller.js.map