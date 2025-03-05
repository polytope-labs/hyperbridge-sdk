import { ProjectNetworkConfig } from '@subql/types-core';
import { ProjectSpecBase } from '../types';
export interface ExampleProjectInterface {
    name: string;
    description: string;
    remote: string;
    path: string;
}
export interface Network {
    code: string;
    name: string;
    chain_id: string;
    description: string;
    logo: string;
}
export interface Template {
    code: string;
    name: string;
    description: string;
    logo: string;
    networks: {
        code: string;
        name: string;
        chain_id: string;
        description: string;
        logo: string;
        examples: ExampleProjectInterface[];
    }[];
}
export declare function fetchTemplates(): Promise<Template[]>;
export declare function fetchNetworks(): Promise<Template[]>;
export declare function fetchExampleProjects(familyCode: string, networkCode: string): Promise<ExampleProjectInterface[]>;
export declare function cloneProjectGit(localPath: string, projectName: string, projectRemote: string, branch: string): Promise<string>;
export declare function cloneProjectTemplate(localPath: string, projectName: string, selectedProject: ExampleProjectInterface): Promise<string>;
export declare function readDefaults(projectPath: string): Promise<{
    endpoint: ProjectNetworkConfig['endpoint'];
    author: string;
    description: string;
    isMultiChainProject: boolean;
}>;
export declare function prepare(projectPath: string, project: ProjectSpecBase, isMultiChainProject?: boolean): Promise<void>;
export declare function preparePackage(projectPath: string, project: ProjectSpecBase): Promise<void>;
export declare function prepareManifest(projectPath: string, project: ProjectSpecBase): Promise<void>;
export declare function addDotEnvConfigCode(manifestData: string): string;
export declare function prepareEnv(projectPath: string, project: ProjectSpecBase): Promise<void>;
export declare function prepareGitIgnore(projectPath: string): Promise<void>;
export declare function installDependencies(projectPath: string, useNpm?: boolean): void;
export declare function prepareProjectScaffold(projectPath: string): Promise<void>;
export declare function validateEthereumProjectManifest(projectPath: string): Promise<boolean>;
