import type { ConstructorFragment, EventFragment, Fragment, FunctionFragment } from '@ethersproject/abi';
import type { SubqlRuntimeDatasource as EthereumDs, SubqlRuntimeHandler } from '@subql/types-ethereum';
import { Document } from 'yaml';
import { SelectedMethod, UserInput } from '../commands/codegen/generate';
interface HandlerPropType {
    name: string;
    argName: string;
    argType: string;
}
interface AbiPropType {
    name: string;
    handlers: HandlerPropType[];
}
export declare const ROOT_MAPPING_DIR = "src/mappings";
export declare const DEFAULT_HANDLER_BUILD_PATH = "./dist/index.js";
export declare const DEFAULT_ABI_DIR = "/abis";
export declare function removeKeyword(inputString: string): string;
export declare function prepareAbiDirectory(abiPath: string, rootPath: string): Promise<void>;
export declare function constructMethod<T extends ConstructorFragment | Fragment>(cleanedFragment: Record<string, T>): SelectedMethod[];
export declare function promptSelectables<T extends ConstructorFragment | Fragment>(method: 'event' | 'function', availableMethods: Record<string, T>): Promise<Record<string, T>>;
export declare function filterObjectsByStateMutability(obj: Record<string, FunctionFragment>): Record<string, FunctionFragment>;
export declare function getFragmentFormats<T extends ConstructorFragment | Fragment>(fragment: T): {
    full: string;
    min: string;
};
export declare function generateHandlerName(name: string, abiName: string, type: 'tx' | 'log'): string;
export declare function constructDatasourcesTs(userInput: UserInput): string;
export declare function constructDatasourcesYaml(userInput: UserInput): EthereumDs;
export declare function prepareInputFragments<T extends ConstructorFragment | Fragment>(type: 'event' | 'function', rawInput: string | undefined, availableFragments: Record<string, T>, abiName: string): Promise<Record<string, T>>;
export type ManifestExtractor<T> = (dataSources: T, casedInputAddress: string | undefined) => {
    existingEvents: string[];
    existingFunctions: string[];
};
export declare function filterExistingMethods<T>(eventFragments: Record<string, EventFragment>, functionFragments: Record<string, FunctionFragment>, dataSources: T, address: string | undefined, extractor: ManifestExtractor<T>): [Record<string, EventFragment>, Record<string, FunctionFragment>];
export declare const yamlExtractor: ManifestExtractor<EthereumDs[]>;
export declare const tsExtractor: ManifestExtractor<string>;
export declare function getManifestData(manifestPath: string): Promise<Document>;
export declare function prependDatasources(dsStr: string, toPendStr: string): string;
export declare function generateManifestTs(manifestPath: string, userInput: UserInput, existingManifestData: string): Promise<void>;
export declare function generateManifestYaml(manifestPath: string, userInput: UserInput, existingManifestData: Document): Promise<void>;
export declare function constructHandlerProps(methods: [SelectedMethod[], SelectedMethod[]], abiName: string): AbiPropType;
export declare function generateHandlers(selectedMethods: [SelectedMethod[], SelectedMethod[]], projectPath: string, abiName: string): Promise<void>;
export declare function tsStringify(obj: SubqlRuntimeHandler | SubqlRuntimeHandler[] | string, indent?: number, currentIndent?: number): string;
export {};
