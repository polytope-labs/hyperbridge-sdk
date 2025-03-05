import { Command } from '@oclif/core';
export default class MultiChainAdd extends Command {
    static description: string;
    static flags: {
        multichain: import("@oclif/core/lib/interfaces").OptionFlag<string, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        chainManifestPath: import("@oclif/core/lib/interfaces").OptionFlag<string | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
    };
    run(): Promise<void>;
}
