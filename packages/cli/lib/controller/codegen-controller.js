"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateJsonInterfaces = generateJsonInterfaces;
exports.generateEnums = generateEnums;
exports.processFields = processFields;
exports.codegen = codegen;
exports.generateSchemaModels = generateSchemaModels;
exports.validateEntityName = validateEntityName;
exports.generateModels = generateModels;
exports.generateDatasourceTemplates = generateDatasourceTemplates;
const tslib_1 = require("tslib");
const assert_1 = tslib_1.__importDefault(require("assert"));
const path_1 = tslib_1.__importDefault(require("path"));
const common_1 = require("@subql/common");
const utils_1 = require("@subql/utils");
const lodash_1 = require("lodash");
const modulars_1 = require("../modulars");
const utils_2 = require("../utils");
const MODEL_TEMPLATE_PATH = path_1.default.resolve(__dirname, '../template/model.ts.ejs');
const MODELS_INDEX_TEMPLATE_PATH = path_1.default.resolve(__dirname, '../template/models-index.ts.ejs');
const TYPES_INDEX_TEMPLATE_PATH = path_1.default.resolve(__dirname, '../template/types-index.ts.ejs');
const INTERFACE_TEMPLATE_PATH = path_1.default.resolve(__dirname, '../template/interface.ts.ejs');
const ENUM_TEMPLATE_PATH = path_1.default.resolve(__dirname, '../template/enum.ts.ejs');
const DYNAMIC_DATASOURCE_TEMPLATE_PATH = path_1.default.resolve(__dirname, '../template/datasource-templates.ts.ejs');
const TYPE_ROOT_DIR = 'src/types';
const MODEL_ROOT_DIR = 'src/types/models';
const RESERVED_KEYS = ['filter', 'filters'];
const exportTypes = {
    models: false,
    interfaces: false,
    enums: false,
    datasources: false,
};
async function generateJsonInterfaces(projectPath, schema) {
    const typesDir = path_1.default.join(projectPath, TYPE_ROOT_DIR);
    const jsonObjects = (0, utils_1.getAllJsonObjects)(schema);
    const jsonInterfaces = jsonObjects.map((r) => {
        const object = (0, utils_1.setJsonObjectType)(r, jsonObjects);
        const fields = processFields('jsonField', object.name, object.fields);
        return {
            interfaceName: object.name,
            fields,
        };
    });
    if (jsonInterfaces.length !== 0) {
        const interfaceTemplate = {
            props: {
                jsonInterfaces,
            },
            helper: {
                upperFirst: lodash_1.upperFirst,
            },
        };
        try {
            await (0, utils_2.renderTemplate)(INTERFACE_TEMPLATE_PATH, path_1.default.join(typesDir, `interfaces.ts`), interfaceTemplate);
            exportTypes.interfaces = true;
        }
        catch (e) {
            throw new Error(`Codegen failed for json interface.`, { cause: e });
        }
    }
}
async function generateEnums(projectPath, schema) {
    const typesDir = path_1.default.join(projectPath, TYPE_ROOT_DIR);
    const jsonObjects = (0, utils_1.getAllEnums)(schema);
    const enums = jsonObjects.map((r) => {
        return {
            name: r.name,
            values: r.getValues().map((v) => v.name),
        };
    });
    if (enums.length !== 0) {
        const enumsTemplate = {
            props: {
                enums,
            },
        };
        try {
            await (0, utils_2.renderTemplate)(ENUM_TEMPLATE_PATH, path_1.default.join(typesDir, `enums.ts`), enumsTemplate);
            exportTypes.enums = true;
        }
        catch (e) {
            throw new Error(`Codegen failed for enums.`, { cause: e });
        }
    }
}
function processFields(type, className, fields, indexFields = []) {
    const fieldList = [];
    for (const field of fields) {
        const injectField = {
            name: field.name,
            required: !field.nullable,
            isArray: field.isArray,
            isEnum: false,
        };
        if (type === 'entity') {
            const [indexed, unique] = indexFields.reduce((acc, indexField) => {
                if (indexField.fields.includes(field.name) && indexField.fields.length <= 1) {
                    acc[0] = true;
                    if (indexField.fields.length === 1 && indexField.unique) {
                        acc[1] = true;
                    }
                    else if (indexField.unique === undefined) {
                        acc[1] = false;
                    }
                }
                return acc;
            }, [false, undefined]);
            injectField.indexed = indexed;
            injectField.unique = unique;
        }
        if (field.isEnum) {
            injectField.type = field.type;
            injectField.isEnum = true;
            injectField.isJsonInterface = false;
        }
        else {
            switch (field.type) {
                default: {
                    const typeClass = (0, utils_1.getTypeByScalarName)(field.type);
                    (0, assert_1.default)(typeClass && typeClass.tsType, `Schema: undefined type "${field.type.toString()}" on field "${field.name}" in "type ${className} @${type}"`);
                    injectField.type = typeClass.tsType;
                    injectField.isJsonInterface = false;
                    break;
                }
                case 'Json': {
                    if (field.jsonInterface === undefined) {
                        throw new Error(`On field ${field.name} type is Json but json interface is not defined`);
                    }
                    injectField.type = (0, lodash_1.upperFirst)(field.jsonInterface.name);
                    injectField.isJsonInterface = true;
                }
            }
        }
        fieldList.push(injectField);
    }
    return fieldList;
}
//1. Prepare models directory and load schema
async function codegen(projectPath, fileNames = [common_1.DEFAULT_MANIFEST]) {
    const modelDir = path_1.default.join(projectPath, MODEL_ROOT_DIR);
    const interfacesPath = path_1.default.join(projectPath, TYPE_ROOT_DIR, `interfaces.ts`);
    await (0, utils_2.prepareDirPath)(modelDir, true);
    await (0, utils_2.prepareDirPath)(interfacesPath, false);
    const plainManifests = fileNames.map((fileName) => {
        const project = (0, common_1.loadFromJsonOrYaml)((0, common_1.getManifestPath)(projectPath, fileName));
        project.networkFamily = (0, common_1.getProjectNetwork)(project);
        return project;
    });
    const expectKeys = ['datasources', 'templates'];
    const customDatasources = plainManifests.flatMap((plainManifest) => {
        return Object.keys(plainManifest)
            .filter((key) => !expectKeys.includes(key))
            .map((dsKey) => {
            const value = plainManifest[dsKey];
            if (typeof value === 'object' && value) {
                return !!Object.keys(value).find((d) => d === 'assets') && value;
            }
        })
            .filter(Boolean);
    });
    const schema = (0, common_1.getSchemaPath)(projectPath, fileNames[0]);
    await generateSchemaModels(projectPath, schema);
    let datasources = plainManifests.reduce((prev, current) => {
        return prev.concat(current.dataSources);
    }, []);
    const templates = plainManifests.reduce((prev, current) => {
        if (current.templates && current.templates.length !== 0) {
            return prev.concat(current.templates);
        }
        return prev;
    }, []);
    if (templates.length !== 0) {
        await generateDatasourceTemplates(projectPath, templates);
        datasources = datasources.concat(templates);
    }
    if (customDatasources.length !== 0) {
        datasources = datasources.concat(customDatasources);
    }
    const cosmosManifests = plainManifests.filter((m) => m.networkFamily === common_1.NETWORK_FAMILY.cosmos);
    if (cosmosManifests.length > 0) {
        const cosmosModule = (0, modulars_1.loadDependency)(common_1.NETWORK_FAMILY.cosmos);
        await cosmosModule.projectCodegen(plainManifests, projectPath, utils_2.prepareDirPath, utils_2.renderTemplate, lodash_1.upperFirst, datasources);
    }
    // TODO what about custom datasource processors, e.g. FrontierEvmProcessor, EthermintProcessor
    const ethManifests = plainManifests.filter((m) => m.networkFamily === common_1.NETWORK_FAMILY.ethereum);
    // Todo, starknet codegen not supported yet
    const starknetManifests = plainManifests.filter((m) => m.networkFamily === common_1.NETWORK_FAMILY.starknet);
    // as we determine it is eth network, ds type should SubqlDatasource
    if (ethManifests.length > 0 || (!starknetManifests && !!datasources.find((d) => d?.assets))) {
        const ethModule = (0, modulars_1.loadDependency)(common_1.NETWORK_FAMILY.ethereum);
        await ethModule.generateAbis(datasources, projectPath, utils_2.prepareDirPath, lodash_1.upperFirst, utils_2.renderTemplate);
    }
    if (exportTypes.interfaces || exportTypes.models || exportTypes.enums || exportTypes.datasources) {
        try {
            await (0, utils_2.renderTemplate)(TYPES_INDEX_TEMPLATE_PATH, path_1.default.join(projectPath, TYPE_ROOT_DIR, `index.ts`), {
                props: {
                    exportTypes,
                },
            });
        }
        catch (e) {
            throw new Error(`Codegen failed for indexes.`, { cause: e });
        }
        console.log(`* Types index generated !`);
    }
}
async function generateSchemaModels(projectPath, schemaPath) {
    const modelDir = path_1.default.join(projectPath, MODEL_ROOT_DIR);
    const interfacesPath = path_1.default.join(projectPath, TYPE_ROOT_DIR, `interfaces.ts`);
    await (0, utils_2.prepareDirPath)(modelDir, true);
    await (0, utils_2.prepareDirPath)(interfacesPath, false);
    await generateJsonInterfaces(projectPath, schemaPath);
    await generateModels(projectPath, schemaPath);
    await generateEnums(projectPath, schemaPath);
}
function validateEntityName(name) {
    for (const reservedKey of RESERVED_KEYS) {
        if (name.toLowerCase().endsWith(reservedKey.toLowerCase())) {
            throw new Error(`EntityName: ${name} cannot end with reservedKey: ${reservedKey}`);
        }
    }
    return name;
}
// 2. Loop all entities and render it
async function generateModels(projectPath, schema) {
    const extractEntities = (0, utils_1.getAllEntitiesRelations)(schema);
    for (const entity of extractEntities.models) {
        const baseFolderPath = '.../../base';
        const className = (0, lodash_1.upperFirst)(entity.name);
        const entityName = validateEntityName(entity.name);
        const fields = processFields('entity', className, entity.fields, entity.indexes);
        const idType = fields.find((f) => f.name === 'id')?.type ?? 'string';
        const importJsonInterfaces = (0, lodash_1.uniq)(fields.filter((field) => field.isJsonInterface).map((f) => f.type));
        const importEnums = (0, lodash_1.uniq)(fields.filter((field) => field.isEnum).map((f) => f.type));
        const indexedFields = fields.filter((field) => field.indexed && !field.isJsonInterface);
        const modelTemplate = {
            props: {
                baseFolderPath,
                className,
                entityName,
                fields,
                importJsonInterfaces,
                importEnums,
                indexedFields,
                idType,
            },
            helper: {
                upperFirst: lodash_1.upperFirst,
            },
        };
        try {
            await (0, utils_2.renderTemplate)(MODEL_TEMPLATE_PATH, path_1.default.join(projectPath, MODEL_ROOT_DIR, `${className}.ts`), modelTemplate);
        }
        catch (e) {
            console.error(e);
            throw new Error(`Codegen failed for entity ${className}.`, { cause: e });
        }
        console.log(`* Schema ${className} generated !`);
    }
    const classNames = extractEntities.models.map((entity) => (0, lodash_1.upperFirst)(entity.name));
    if (classNames.length !== 0) {
        try {
            await (0, utils_2.renderTemplate)(MODELS_INDEX_TEMPLATE_PATH, path_1.default.join(projectPath, MODEL_ROOT_DIR, `index.ts`), {
                props: {
                    classNames,
                },
                helper: {
                    upperFirst: lodash_1.upperFirst,
                },
            });
            exportTypes.models = true;
        }
        catch (e) {
            throw new Error(`Failed to codgen for model indexes.`, { cause: e });
        }
        console.log(`* Models index generated !`);
    }
}
async function generateDatasourceTemplates(projectPath, templates) {
    const props = templates.map((t) => ({
        name: t.name,
        args: 'Record<string, unknown>',
    }));
    const propsWithoutDuplicates = (0, lodash_1.uniqBy)(props, (prop) => `${prop.name}-${prop.args}`);
    try {
        await (0, utils_2.renderTemplate)(DYNAMIC_DATASOURCE_TEMPLATE_PATH, path_1.default.join(projectPath, TYPE_ROOT_DIR, `datasources.ts`), {
            props: propsWithoutDuplicates,
        });
        exportTypes.datasources = true;
    }
    catch (e) {
        console.error(e);
        throw new Error(`Unable to generate datasource template constructors`);
    }
    console.log(`* Datasource template constructors generated !`);
}
//# sourceMappingURL=codegen-controller.js.map