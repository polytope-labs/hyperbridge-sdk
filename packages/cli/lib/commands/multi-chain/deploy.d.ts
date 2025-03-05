import { Command } from '@oclif/core';
export default class MultiChainDeploy extends Command {
    static description: string;
    static flags: {
        location: import("@oclif/core/lib/interfaces").OptionFlag<string, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        ipfs: import("@oclif/core/lib/interfaces").OptionFlag<string | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        org: import("@oclif/core/lib/interfaces").OptionFlag<string | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        projectName: import("@oclif/core/lib/interfaces").OptionFlag<string | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        type: import("@oclif/core/lib/interfaces").OptionFlag<import("../../types").DeploymentType>;
        indexerVersion: import("@oclif/core/lib/interfaces").OptionFlag<string | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        queryVersion: import("@oclif/core/lib/interfaces").OptionFlag<string | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        dict: import("@oclif/core/lib/interfaces").OptionFlag<string | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        endpoint: import("@oclif/core/lib/interfaces").OptionFlag<string | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        indexerUnsafe: import("@oclif/core/lib/interfaces").BooleanFlag<boolean>;
        indexerBatchSize: import("@oclif/core/lib/interfaces").OptionFlag<number | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        indexerSubscription: import("@oclif/core/lib/interfaces").BooleanFlag<boolean>;
        disableHistorical: import("@oclif/core/lib/interfaces").BooleanFlag<boolean>;
        indexerUnfinalized: import("@oclif/core/lib/interfaces").BooleanFlag<boolean>;
        indexerStoreCacheThreshold: import("@oclif/core/lib/interfaces").OptionFlag<number | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        disableIndexerStoreCacheAsync: import("@oclif/core/lib/interfaces").BooleanFlag<boolean>;
        indexerWorkers: import("@oclif/core/lib/interfaces").OptionFlag<number | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        queryUnsafe: import("@oclif/core/lib/interfaces").BooleanFlag<boolean>;
        querySubscription: import("@oclif/core/lib/interfaces").BooleanFlag<boolean>;
        queryTimeout: import("@oclif/core/lib/interfaces").OptionFlag<number | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        queryMaxConnection: import("@oclif/core/lib/interfaces").OptionFlag<number | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        queryAggregate: import("@oclif/core/lib/interfaces").BooleanFlag<boolean>;
        queryLimit: import("@oclif/core/lib/interfaces").OptionFlag<number | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        useDefaults: import("@oclif/core/lib/interfaces").BooleanFlag<boolean>;
    };
    run(): Promise<void>;
}
