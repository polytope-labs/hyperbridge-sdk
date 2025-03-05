import { Configuration } from 'webpack';
export declare function runWebpack(buildEntries: Configuration['entry'], projectDir: string, outputDir: string, isDev?: boolean, clean?: boolean): Promise<void>;
export declare function getBuildEntries(directory: string): Record<string, string>;
