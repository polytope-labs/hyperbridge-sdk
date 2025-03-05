export declare function buildManifestFromLocation(location: string, log: (...args: any[]) => void): Promise<string>;
export declare function generateManifestFromTs(projectManifestEntry: string, log: (...args: any[]) => void): Promise<string>;
export declare function getTsManifest(location: string): string | null;
