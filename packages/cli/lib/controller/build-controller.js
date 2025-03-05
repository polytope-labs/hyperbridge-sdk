"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWebpack = runWebpack;
exports.getBuildEntries = getBuildEntries;
const tslib_1 = require("tslib");
const assert_1 = tslib_1.__importDefault(require("assert"));
const fs_1 = require("fs");
const path_1 = tslib_1.__importDefault(require("path"));
const glob_1 = require("glob");
const terser_webpack_plugin_1 = tslib_1.__importDefault(require("terser-webpack-plugin"));
const tsconfig_paths_webpack_plugin_1 = require("tsconfig-paths-webpack-plugin");
const webpack_1 = tslib_1.__importDefault(require("webpack"));
const webpack_merge_1 = require("webpack-merge");
const getBaseConfig = (buildEntries, projectDir, outputDir, development) => ({
    target: 'node',
    mode: development ? 'development' : 'production',
    context: projectDir,
    entry: buildEntries,
    devtool: 'inline-source-map',
    optimization: {
        minimize: true,
        minimizer: [
            new terser_webpack_plugin_1.default({
                terserOptions: {
                    sourceMap: true,
                    format: {
                        beautify: true,
                    },
                },
            }),
        ],
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                exclude: /node_modules/,
                loader: require.resolve('ts-loader'),
                options: {
                    compilerOptions: {
                        declaration: false,
                    },
                },
            },
            {
                test: /\.ya?ml$/,
                use: 'yaml-loader',
            },
        ],
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js', '.json'],
        plugins: [new tsconfig_paths_webpack_plugin_1.TsconfigPathsPlugin()],
    },
    output: {
        path: outputDir,
        filename: '[name].js',
        libraryTarget: 'commonjs',
    },
});
async function runWebpack(buildEntries, projectDir, outputDir, isDev = false, clean = false) {
    const config = (0, webpack_merge_1.merge)(getBaseConfig(buildEntries, projectDir, outputDir, isDev), { output: { clean } }
    // Can allow projects to override webpack config here
    );
    await new Promise((resolve, reject) => {
        (0, webpack_1.default)(config).run((error, stats) => {
            if (error) {
                reject(error);
                return;
            }
            (0, assert_1.default)(stats, 'Webpack stats is undefined');
            if (stats.hasErrors()) {
                const info = stats.toJson();
                reject(info.errors?.map((e) => e.message).join('\n') ?? 'Unknown error');
                return;
            }
            resolve(true);
        });
    });
}
function getBuildEntries(directory) {
    // FIXME: this is an assumption that the default entry is src/index.ts, in reality it should read from the project manifest
    const defaultEntry = path_1.default.join(directory, 'src/index.ts');
    let buildEntries = {
        index: defaultEntry,
    };
    (0, glob_1.globSync)(path_1.default.join(directory, 'src/test/**/*.test.ts')).forEach((testFile) => {
        const testName = path_1.default.basename(testFile).replace('.ts', '');
        buildEntries[`test/${testName}`] = testFile;
    });
    (0, glob_1.globSync)(path_1.default.join(directory, 'src/tests/**/*.test.ts')).forEach((testFile) => {
        const testName = path_1.default.basename(testFile).replace('.ts', '');
        buildEntries[`tests/${testName}`] = testFile;
    });
    // Get the output location from the project package.json main field
    const pjson = JSON.parse((0, fs_1.readFileSync)(path_1.default.join(directory, 'package.json')).toString());
    if (pjson.exports && typeof pjson.exports !== 'string') {
        buildEntries = Object.entries(pjson.exports).reduce((acc, [key, value]) => {
            acc[key] = path_1.default.resolve(directory, value);
            return acc;
        }, { ...buildEntries });
    }
    for (const i in buildEntries) {
        if (typeof buildEntries[i] !== 'string') {
            console.warn(`Ignoring entry ${i} from build.`);
            delete buildEntries[i];
        }
    }
    return buildEntries;
}
//# sourceMappingURL=build-controller.js.map