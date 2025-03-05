"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importStar(require("fs"));
const path_1 = tslib_1.__importDefault(require("path"));
const core_1 = require("@oclif/core");
const common_1 = require("@subql/common");
const generate_controller_1 = require("../../controller/generate-controller");
const modulars_1 = require("../../modulars");
const utils_1 = require("../../utils");
class Generate extends core_1.Command {
    static description = 'Generate Project.yaml and mapping functions based on provided ABI';
    static flags = {
        file: core_1.Flags.string({ char: 'f', description: 'specify manifest file path' }),
        events: core_1.Flags.string({ description: 'abi events, --events="approval, transfer"' }),
        functions: core_1.Flags.string({ description: 'abi functions,  --functions="approval, transfer"' }),
        abiPath: core_1.Flags.string({ description: 'path to abi from root', required: true }),
        startBlock: core_1.Flags.integer({ description: 'startBlock', required: true }),
        address: core_1.Flags.string({ description: 'contract address' }),
    };
    prepareUserInput(selectedEvents, selectedFunctions, existingDs, address, startBlock, abiFileName, extractor) {
        const [cleanEvents, cleanFunctions] = (0, generate_controller_1.filterExistingMethods)(selectedEvents, selectedFunctions, existingDs, address, extractor);
        const constructedEvents = (0, generate_controller_1.constructMethod)(cleanEvents);
        const constructedFunctions = (0, generate_controller_1.constructMethod)(cleanFunctions);
        return {
            startBlock: startBlock,
            functions: constructedFunctions,
            events: constructedEvents,
            abiPath: `./abis/${abiFileName}`,
            address: address,
        };
    }
    async run() {
        const { flags } = await this.parse(Generate);
        const { abiPath, address, events, file, functions, startBlock } = flags;
        let manifest, root;
        let isTs;
        const projectPath = path_1.default.resolve(file ?? process.cwd());
        if ((0, fs_1.lstatSync)(projectPath).isDirectory()) {
            if (fs_1.default.existsSync(path_1.default.join(projectPath, common_1.DEFAULT_TS_MANIFEST))) {
                manifest = path_1.default.join(projectPath, common_1.DEFAULT_TS_MANIFEST);
                isTs = true;
            }
            else {
                manifest = path_1.default.join(projectPath, common_1.DEFAULT_MANIFEST);
                isTs = false;
            }
            root = projectPath;
        }
        else if ((0, fs_1.lstatSync)(projectPath).isFile()) {
            const { dir, ext } = path_1.default.parse(projectPath);
            root = dir;
            isTs = (0, common_1.extensionIsTs)(ext);
            manifest = projectPath;
        }
        else {
            this.error('Invalid manifest path');
        }
        const ethModule = (0, modulars_1.loadDependency)(common_1.NETWORK_FAMILY.ethereum);
        const abiName = ethModule.parseContractPath(abiPath).name;
        if (fs_1.default.existsSync(path_1.default.join(root, 'src/mappings/', `${abiName}Handlers.ts`))) {
            throw new Error(`file: ${abiName}Handlers.ts already exists`);
        }
        await (0, generate_controller_1.prepareAbiDirectory)(abiPath, root);
        const abiFileName = path_1.default.basename(abiPath);
        // fragments from abi
        const abiInterface = ethModule.getAbiInterface(root, abiFileName);
        const eventsFragments = abiInterface.events;
        const functionFragments = (0, generate_controller_1.filterObjectsByStateMutability)(abiInterface.functions);
        const selectedEvents = await (0, generate_controller_1.prepareInputFragments)('event', events, eventsFragments, abiName);
        const selectedFunctions = await (0, generate_controller_1.prepareInputFragments)('function', functions, functionFragments, abiName);
        let userInput;
        try {
            if (isTs) {
                const existingManifest = await fs_1.default.promises.readFile(manifest, 'utf8');
                const extractedDatasources = (0, utils_1.extractFromTs)(existingManifest, {
                    dataSources: undefined,
                });
                const existingDs = extractedDatasources.dataSources;
                userInput = this.prepareUserInput(selectedEvents, selectedFunctions, existingDs, address, startBlock, abiFileName, generate_controller_1.tsExtractor);
                await (0, generate_controller_1.generateManifestTs)(manifest, userInput, existingManifest);
            }
            else {
                // yaml
                const existingManifest = await (0, generate_controller_1.getManifestData)(manifest);
                const existingDs = existingManifest.get('dataSources')?.toJSON() ?? [];
                userInput = this.prepareUserInput(selectedEvents, selectedFunctions, existingDs, address, startBlock, abiFileName, generate_controller_1.yamlExtractor);
                await (0, generate_controller_1.generateManifestYaml)(manifest, userInput, existingManifest);
            }
            await (0, generate_controller_1.generateHandlers)([userInput.events, userInput.functions], root, abiName);
            this.log('-----------Generated-----------');
            userInput.functions.forEach((fn) => {
                this.log(`Function: ${fn.name} successfully generated`);
            });
            userInput.events.forEach((event) => {
                this.log(`Event: ${event.name} successfully generated`);
            });
            this.log('-------------------------------');
        }
        catch (e) {
            this.error(e);
        }
    }
}
exports.default = Generate;
//# sourceMappingURL=generate.js.map