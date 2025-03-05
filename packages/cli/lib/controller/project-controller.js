"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.suffixFormat = void 0;
exports.getProject = getProject;
exports.createProject = createProject;
exports.deleteProject = deleteProject;
const tslib_1 = require("tslib");
const axios_1 = tslib_1.__importDefault(require("axios"));
const utils_1 = require("../utils");
const suffixFormat = (value) => {
    return value
        .replace(/(^\s*)|(\s*$)/g, '')
        .replace(/\s+/g, '-')
        .toLowerCase();
};
exports.suffixFormat = suffixFormat;
async function getProject(url, authToken, key) {
    try {
        const res = await (0, axios_1.default)({
            headers: {
                Authorization: `Bearer ${authToken}`,
            },
            method: 'get',
            url: `/subqueries/${key}`,
            baseURL: url,
        });
        return res.data;
    }
    catch (e) {
        if (axios_1.default.isAxiosError(e) && e.response?.status === 404) {
            return undefined;
        }
        console.log('ERRROR', e);
        throw (0, utils_1.errorHandle)(e, 'Failed to get project:');
    }
}
async function createProject(url, authToken, body) {
    try {
        const res = await (0, axios_1.default)({
            headers: {
                Authorization: `Bearer ${authToken}`,
            },
            method: 'post',
            url: 'subqueries',
            baseURL: url,
            data: {
                gitRepository: '', // Deprecated
                ...body,
            },
        });
        return res.data;
    }
    catch (e) {
        throw (0, utils_1.errorHandle)(e, 'Failed to create project:');
    }
}
async function deleteProject(authToken, organization, project_name, url) {
    const key = `${organization}/${project_name.toLowerCase()}`;
    try {
        await (0, axios_1.default)({
            headers: {
                Authorization: `Bearer ${authToken}`,
            },
            method: 'delete',
            url: `subqueries/${key}`,
            baseURL: url,
        });
        return `${key}`;
    }
    catch (e) {
        throw (0, utils_1.errorHandle)(e, 'Failed to delete project:');
    }
}
//# sourceMappingURL=project-controller.js.map