import { Document } from 'yaml';
export declare function addChain(multichain: string, chainManifestPath: string): Promise<void>;
export declare function determineMultichainManifestPath(multichain: string): string;
export declare function loadMultichainManifest(multichainManifestPath: string): Document;
export declare function handleChainManifestOrId(chainManifestPath: string): string;
export declare function validateAndAddChainManifest(projectDir: string, chainManifestPath: string, multichainManifest: Document): void;
export declare function loadDockerComposeFile(dockerComposePath: string): Document | undefined;
export declare function updateDockerCompose(projectDir: string, chainManifestPath: string): Promise<void>;
