"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.createIPFSFile = createIPFSFile;
exports.uploadToIpfs = uploadToIpfs;
exports.uploadFiles = uploadFiles;
exports.uploadFile = uploadFile;
exports.getDirectoryCid = getDirectoryCid;
const tslib_1 = require("tslib");
const assert_1 = tslib_1.__importDefault(require("assert"));
const fs_1 = tslib_1.__importDefault(require("fs"));
const path_1 = tslib_1.__importDefault(require("path"));
const common_1 = require("@subql/common");
const modulars_1 = require("../modulars");
const PIN_SERVICE = 'onfinality';
async function createIPFSFile(root, manifest, cid) {
    const { name } = path_1.default.parse(manifest);
    const MANIFEST_FILE = path_1.default.join(root, `.${name}-cid`);
    try {
        await fs_1.default.promises.writeFile(MANIFEST_FILE, cid, 'utf8');
    }
    catch (e) {
        throw new Error(`Failed to create CID file: ${e}`);
    }
}
async function uploadToIpfs(projectPaths, authToken, multichainProjectPath, ipfsEndpoint, directory) {
    const projectToReader = {};
    await Promise.all(projectPaths.map(async (projectPath) => {
        const reader = await common_1.ReaderFactory.create(projectPath);
        projectToReader[projectPath] = reader;
    }));
    const contents = [];
    let ipfs;
    if (ipfsEndpoint) {
        ipfs = new common_1.IPFSHTTPClientLite({ url: ipfsEndpoint });
    }
    for (const project in projectToReader) {
        const reader = projectToReader[project];
        const schema = await reader.getProjectSchema();
        (0, common_1.validateCommonProjectManifest)(schema);
        const networkFamily = (0, common_1.getProjectNetwork)(schema);
        const module = (0, modulars_1.loadDependency)(networkFamily);
        (0, assert_1.default)(module, `Failed to load module for network ${networkFamily}`);
        let manifest;
        try {
            manifest = module.parseProjectManifest(schema).asImpl;
        }
        catch (e) {
            throw new Error(`Failed to parse project manifest for network ${networkFamily}`, { cause: e });
        }
        if (manifest === null) {
            throw new Error('Unable to parse project manifest');
        }
        (0, assert_1.default)(reader.root, 'Reader root is not set');
        // the JSON object conversion must occur on manifest.deployment
        const deployment = await replaceFileReferences(reader.root, manifest.deployment, authToken, ipfs);
        // Use JSON.* to convert Map to Object
        contents.push({
            path: path_1.default.join(directory ?? '', path_1.default.basename(project)),
            content: deployment.toYaml(),
        });
    }
    if (multichainProjectPath) {
        const content = fs_1.default.readFileSync(multichainProjectPath);
        contents.push({
            path: path_1.default.join(directory ?? '', path_1.default.basename(multichainProjectPath)),
            content: content.toString(),
        });
    }
    // Upload schema
    return uploadFiles(contents, authToken, multichainProjectPath !== undefined, ipfs);
}
/* Recursively finds all FileReferences in an object and replaces the files with IPFS references */
async function replaceFileReferences(projectDir, input, authToken, ipfs) {
    if (Array.isArray(input)) {
        return (await Promise.all(input.map((val) => replaceFileReferences(projectDir, val, authToken, ipfs))));
    }
    else if (typeof input === 'object' && input !== null) {
        if (input instanceof Map) {
            input = (0, common_1.mapToObject)(input);
        }
        if ((0, common_1.isFileReference)(input)) {
            const filePath = path_1.default.resolve(projectDir, input.file);
            const content = fs_1.default.readFileSync(path_1.default.resolve(projectDir, input.file));
            input.file = await uploadFile({ content: content.toString(), path: filePath }, authToken, ipfs).then((cid) => `ipfs://${cid}`);
        }
        const keys = Object.keys(input).filter((key) => key !== '_deployment');
        await Promise.all(keys.map(async (key) => {
            // this is the loop
            input[key] = await replaceFileReferences(projectDir, input[key], authToken, ipfs);
        }));
    }
    return input;
}
const fileMap = new Map();
async function uploadFiles(contents, authToken, isMultichain, ipfs) {
    const fileCidMap = new Map();
    if (ipfs) {
        try {
            const results = await ipfs.addAll(contents, { wrapWithDirectory: isMultichain });
            for (const result of results) {
                fileCidMap.set(result.path, result.cid.toString());
            }
        }
        catch (e) {
            throw new Error(`Publish project to provided IPFS gateway failed`, { cause: e });
        }
    }
    const ipfsWrite = new common_1.IPFSHTTPClientLite({
        url: common_1.IPFS_WRITE_ENDPOINT,
        headers: { Authorization: `Bearer ${authToken}` },
    });
    try {
        const results = await ipfsWrite.addAll(contents, { pin: true, cidVersion: 0, wrapWithDirectory: isMultichain });
        for (const result of results) {
            fileCidMap.set(result.path, result.cid);
            await ipfsWrite.pinRemoteAdd(result.cid, { service: PIN_SERVICE }).catch((e) => {
                console.warn(`Failed to pin file ${result.path}. There might be problems with this file being accessible later. ${e}`);
            });
        }
    }
    catch (e) {
        throw new Error(`Publish project files to IPFS failed`, { cause: e });
    }
    return fileCidMap;
}
async function uploadFile(contents, authToken, ipfs) {
    const pathPromise = fileMap.get(contents.path);
    if (pathPromise !== undefined) {
        return pathPromise;
    }
    let pendingClientCid = Promise.resolve('');
    if (ipfs) {
        pendingClientCid = ipfs
            .add(contents.content, { pin: true, cidVersion: 0 })
            .then((result) => result.cid.toString())
            .catch((e) => {
            throw new Error(`Publish file to provided IPFS failed`, { cause: e });
        });
    }
    const ipfsWrite = new common_1.IPFSHTTPClientLite({
        url: common_1.IPFS_WRITE_ENDPOINT,
        headers: { Authorization: `Bearer ${authToken}` },
    });
    const pendingCid = ipfsWrite
        .add(contents.content, { pin: true, cidVersion: 0 })
        .then((result) => result.cid)
        .then(async (cid) => {
        try {
            await ipfsWrite.pinRemoteAdd(cid, { service: PIN_SERVICE });
            return cid.toString();
        }
        catch (e) {
            console.warn(`Failed to pin file ${contents.path}. There might be problems with this file being accessible later. ${e}`);
            return cid.toString();
        }
    })
        .catch((e) => {
        throw new Error(`Publish project to default IPFS failed`, { cause: e });
    });
    fileMap.set(contents.path, pendingCid);
    const [cid, clientCid] = await Promise.all([pendingCid, pendingClientCid]);
    if (clientCid && clientCid !== cid) {
        throw new Error(`Published and received IPFS cid not identical \n,
    Client IPFS: ${clientCid}, IPFS: ${cid}`);
    }
    return cid;
}
function getDirectoryCid(fileToCidMap) {
    const directoryCid = fileToCidMap.get('');
    return directoryCid;
}
//# sourceMappingURL=publish-controller.js.map