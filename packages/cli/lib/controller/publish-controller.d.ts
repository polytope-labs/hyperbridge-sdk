import { IPFSHTTPClientLite } from '@subql/common';
export declare function createIPFSFile(root: string, manifest: string, cid: string): Promise<void>;
export declare function uploadToIpfs(projectPaths: string[], authToken: string, multichainProjectPath?: string, ipfsEndpoint?: string, directory?: string): Promise<Map<string, string>>;
export declare function uploadFiles(contents: {
    path: string;
    content: string;
}[], authToken: string, isMultichain?: boolean, ipfs?: IPFSHTTPClientLite): Promise<Map<string, string>>;
export declare function uploadFile(contents: {
    path: string;
    content: string;
}, authToken: string, ipfs?: IPFSHTTPClientLite): Promise<string>;
export declare function getDirectoryCid(fileToCidMap: Map<string, string>): string | undefined;
