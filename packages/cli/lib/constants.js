"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SUBQL_SCHEMA = exports.DEFAULT_SUBQL_MANIFEST = exports.DEFAULT_SUBGRAPH_SCHEMA = exports.DEFAULT_SUBGRAPH_MANIFEST = exports.ACCESS_TOKEN_PATH = exports.CAPTURE_CHAIN_ID_REG = exports.CHAIN_ID_REG = exports.FUNCTION_REG = exports.TOPICS_REG = exports.ADDRESS_REG = exports.ENDPOINT_REG = exports.BASE_TEMPLATE_URl = exports.BASE_PROJECT_URL = exports.ROOT_API_URL_PROD = exports.DEFAULT_DEPLOYMENT_TYPE = void 0;
const tslib_1 = require("tslib");
const assert_1 = tslib_1.__importDefault(require("assert"));
const path_1 = tslib_1.__importDefault(require("path"));
//DEPLOYMENT
exports.DEFAULT_DEPLOYMENT_TYPE = 'primary';
//PROJECT
exports.ROOT_API_URL_PROD = 'https://api.subquery.network';
exports.BASE_PROJECT_URL = 'https://managedservice.subquery.network';
exports.BASE_TEMPLATE_URl = 'https://templates.subquery.network';
// Regex for cold tsManifest
exports.ENDPOINT_REG = /endpoint:\s*(\[[^\]]+\]|['"`][^'"`]+['"`])/;
exports.ADDRESS_REG = /address\s*:\s*['"]([^'"]+)['"]/;
exports.TOPICS_REG = /topics:\s*(\[[^\]]+\]|['"`][^'"`]+['"`])/;
exports.FUNCTION_REG = /function\s*:\s*['"]([^'"]+)['"]/;
exports.CHAIN_ID_REG = /chainId:\s*(\[[^\]]+\]|['"`][^'"`]+['"`])/;
exports.CAPTURE_CHAIN_ID_REG = /chainId:\s*("([^"]*)"|(?<!")(\d+))/;
const rootPath = process.env[process.platform === 'win32' ? 'USERPROFILE' : 'HOME'];
(0, assert_1.default)(rootPath, 'Cannot determine root path, please create an issue and include your OS. https://github.com/subquery/subql/issues/new');
exports.ACCESS_TOKEN_PATH = path_1.default.resolve(rootPath, '.subql/SUBQL_ACCESS_TOKEN');
exports.DEFAULT_SUBGRAPH_MANIFEST = 'subgraph.yaml';
exports.DEFAULT_SUBGRAPH_SCHEMA = 'schema.graphql';
exports.DEFAULT_SUBQL_MANIFEST = 'project.ts';
exports.DEFAULT_SUBQL_SCHEMA = 'schema.graphql';
//# sourceMappingURL=constants.js.map