"use strict";
// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrateSchema = migrateSchema;
exports.migrateSchemaFromString = migrateSchemaFromString;
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importDefault(require("fs"));
const graphql_1 = require("graphql");
// Extra schema definitions used by the graph
// const subgraphScalars = gql`
//   scalar Int8
//   scalar Timestamp
// `;
// const subgraphDirectives = gql`
//   type FulltextInclude {
//     name: String!
//   }
//   directive @fulltext(name: String!, language: String!, algorithm: String!, include: [FulltextInclude!]!) on OBJECT
// `;
async function migrateSchema(subgraphSchemaPath, subqlSchemaPath) {
    await fs_1.default.promises.rm(subqlSchemaPath, { force: true });
    const file = await fs_1.default.promises.readFile(subgraphSchemaPath);
    const output = migrateSchemaFromString(file.toString('utf8'));
    await fs_1.default.promises.writeFile(subqlSchemaPath, output);
    console.log(`* schema.graphql has been migrated. If there are any issues see our documentation for more details https://academy.subquery.network/build/graphql.html`);
}
// This is the scalars available to Subquery projects.
const subqlScalars = new Set(['String', 'Int', 'Boolean', 'ID', 'Date', 'Bytes', 'Float', 'BigInt', 'BigDecimal']);
function migrateSchemaFromString(input) {
    const src = new graphql_1.Source(input);
    const doc = (0, graphql_1.parse)(src);
    const updated = doc.definitions
        .filter((definition) => {
        if (isObjectType(definition)) {
            const aggregationDirective = definition.directives?.find((d) => d.name.value === 'aggregation');
            if (aggregationDirective) {
                console.warn(`The Aggregation directive is not supported. type="${definition.name.value}" has been removed`);
                return false;
            }
        }
        return true;
    })
        .map((definition) => {
        if (isObjectType(definition)) {
            // Convert fulltext search directives
            if (definition.name.value === '_Schema_') {
                definition.directives?.forEach((directive) => {
                    convertFulltextDirective(directive, doc.definitions);
                });
                // No mutations to the global schema
                return definition;
            }
            // Map field types to known types
            definition.fields = definition.fields?.map((field) => {
                modifyTypeNode(field.type, (type) => {
                    // SubQuery only supports ID type for id
                    if (field.name.value === 'id') {
                        type.name.value = 'ID';
                    }
                    if (type.name.value === 'Int8') {
                        type.name.value = 'Int';
                    }
                    if (type.name.value === 'Timestamp') {
                        type.name.value = 'Date';
                    }
                    // Follow type difference in here https://academy.subquery.network/indexer/build/graph-migration.html#differences-in-the-graphql-schema
                    if (type.name.value === 'BigDecimal') {
                        type.name.value = 'Float';
                    }
                    if (type.name.value === 'Bytes') {
                        type.name.value = 'String';
                    }
                    convertRelations(doc.definitions, definition, field, type);
                    return type;
                });
                return field;
            });
            // Remove unsupported arguments from entity directive
            const entityDirective = definition.directives?.find((d) => d.name.value === 'entity');
            if (!entityDirective)
                throw new Error('Object is missing entity directive');
            entityDirective.arguments = entityDirective.arguments?.filter((arg) => {
                if (arg.name.value === 'immutable') {
                    console.warn(`Immutable option is not supported. Removing from entity="${definition.name.value}"`);
                    return false;
                }
                if (arg.name.value === 'timeseries') {
                    console.warn(`Timeseries option is not supported. Removing from entity="${definition.name.value}"`);
                    return false;
                }
                return true;
            });
        }
        return definition;
    })
        // Remove the _Schema_ type
        .filter((def) => !(isObjectType(def) && def.name.value === '_Schema_'));
    return (0, graphql_1.print)({ ...doc, definitions: updated });
}
function convertFulltextDirective(directive, definitions) {
    if (directive.name.value !== 'fulltext')
        return;
    // TODO should add runtime check for StringValueNode
    const name = directive.arguments?.find((arg) => arg.name.value === 'name')?.value?.value;
    const includeOpt = directive.arguments?.find((arg) => arg.name.value === 'include');
    if (!includeOpt)
        throw new Error("Expected fulltext directive to have an 'include' argument");
    if (includeOpt.value.kind !== graphql_1.Kind.LIST)
        throw new Error('Expected include argument to be a list');
    if (includeOpt.value.values.length !== 1) {
        throw new Error(`SubQuery only supports fulltext search on a single entity. name=${name}`);
    }
    const includeParams = includeOpt.value.values[0];
    // Get the entity name
    if (!isObjectValueNode(includeParams))
        throw new Error(`Expected object value, received ${includeParams.kind}`);
    const entityName = includeParams.fields.find((f) => f.name.value === 'entity')?.value;
    if (!entityName || !isStringValueNode(entityName))
        throw new Error('Entity name is invalid');
    // Get the entity fields
    const fields = includeParams.fields.find((f) => f.name.value === 'fields')?.value;
    if (!fields)
        throw new Error('Unable to find fields for fulltext search');
    if (!isListValueNode(fields))
        throw new Error('Expected fields to be a list');
    const fieldNames = fields.values.map((field) => {
        if (!isObjectValueNode(field))
            throw new Error('Field is invalid');
        const nameField = field.fields.find((f) => f.name.value === 'name');
        if (!nameField)
            throw new Error('Fields field is missing name');
        return nameField.value;
    });
    if (!fieldNames.length)
        throw new Error('Fulltext search requires at least one field');
    // Find the entity to add the directive
    const entity = findEntity(definitions, entityName.value);
    if (!entity)
        throw new Error(`Unable to find entity ${entityName.value} for fulltext search`);
    // Add the fulltext directive to the entity
    entity.directives ??= [];
    entity.directives.push(makeFulltextDirective(fieldNames.map((f) => f.value)));
}
// Some relations are handled differently to the Graph, add the necessary directive here
function convertRelations(definitions, definition, field, type) {
    // This scalars check is a best effort to find types that are relations
    if (!subqlScalars.has(type.name.value)) {
        if (!field.directives?.find((d) => d.name.value === 'derivedFrom') && isListType(field.type)) {
            // Find the referenced entity
            const entity = findEntity(definitions, type.name.value);
            if (!entity) {
                throw new Error(`Cannot find entity referenced by field ${field.name.value} on type ${definition.name.value}`);
            }
            // Only care if its an entity. i.e. not a JSON type
            if (entity.directives?.find((d) => d.name.value === 'entity')) {
                // Try to find a field with the same name as the type
                let name = '';
                const matches = entity.fields?.filter((field) => isFieldOfType(field.type, definition.name.value));
                if (matches?.length === 1) {
                    name = matches?.[0]?.name.value;
                }
                else {
                    if (!matches?.length) {
                        console.warn(`Unable to find a lookup on ${entity.name.value} for "${definition.name.value}.${field.name.value}". You will need to manually set the "field" property`);
                    }
                    else {
                        console.warn(`Found multiple matches of ${entity.name.value} for "${definition.name.value}.${field.name.value}". You will need to manually set the "field" property`);
                    }
                    name = '<replace-me>';
                }
                // Add the necessary directive
                field.directives ??= [];
                field.directives.push(makeDerivedFromDirective(name));
            }
        }
    }
}
// Drills down to the inner type and runs the modFn on it, this runs in place
function modifyTypeNode(type, modFn) {
    if (type.kind === graphql_1.Kind.NON_NULL_TYPE || type.kind === graphql_1.Kind.LIST_TYPE) {
        return modifyTypeNode(type.type, modFn);
    }
    return modFn(type);
}
function isListType(type) {
    if (type.kind === graphql_1.Kind.LIST_TYPE) {
        return true;
    }
    if (type.kind === graphql_1.Kind.NON_NULL_TYPE) {
        return isListType(type.type);
    }
    return false;
}
// Finds the underlying type ignoring nullability
function isFieldOfType(type, desired) {
    if (type.kind === graphql_1.Kind.NON_NULL_TYPE) {
        return isFieldOfType(type.type, desired);
    }
    return type.kind !== graphql_1.Kind.LIST_TYPE && type.name.value === desired;
}
function findEntity(definitions, name) {
    // Cast can be removed with newver version of typescript
    return definitions.find((def) => isObjectType(def) && def.name.value === name);
}
function makeFulltextDirective(fields, language = 'english') {
    return {
        kind: graphql_1.Kind.DIRECTIVE,
        name: {
            kind: graphql_1.Kind.NAME,
            value: 'fullText',
        },
        arguments: [
            {
                kind: graphql_1.Kind.ARGUMENT,
                name: {
                    kind: graphql_1.Kind.NAME,
                    value: 'fields',
                },
                value: {
                    kind: graphql_1.Kind.LIST,
                    values: fields.map((field) => ({
                        kind: graphql_1.Kind.STRING,
                        value: field,
                    })),
                },
            },
            {
                kind: graphql_1.Kind.ARGUMENT,
                name: {
                    kind: graphql_1.Kind.NAME,
                    value: 'language',
                },
                value: {
                    kind: graphql_1.Kind.STRING,
                    value: language,
                },
            },
        ],
    };
}
function makeDerivedFromDirective(field) {
    return {
        kind: graphql_1.Kind.DIRECTIVE,
        name: {
            kind: graphql_1.Kind.NAME,
            value: 'derivedFrom',
        },
        arguments: [
            {
                kind: graphql_1.Kind.ARGUMENT,
                name: {
                    kind: graphql_1.Kind.NAME,
                    value: 'field',
                },
                value: {
                    kind: graphql_1.Kind.STRING,
                    value: field,
                },
            },
        ],
    };
}
function isObjectType(node) {
    return node.kind === graphql_1.Kind.OBJECT_TYPE_DEFINITION;
}
function isObjectValueNode(node) {
    return node.kind === graphql_1.Kind.OBJECT;
}
function isListValueNode(node) {
    return node.kind === graphql_1.Kind.LIST;
}
function isStringValueNode(node) {
    return node.kind === graphql_1.Kind.STRING;
}
//# sourceMappingURL=migrate-schema.controller.js.map