import { Command } from '@oclif/core';
import Delete from './delete';
import Deploy from './deploy';
import Promote from './promote';
export default class Deployment extends Command {
    static description: string;
    static flags: {
        org: import("@oclif/core/lib/interfaces").OptionFlag<string | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        project_name: import("@oclif/core/lib/interfaces").OptionFlag<string | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        deploymentID: import("@oclif/core/lib/interfaces").OptionFlag<string | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        ipfsCID: import("@oclif/core/lib/interfaces").OptionFlag<string | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        endpoint: import("@oclif/core/lib/interfaces").OptionFlag<string, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        projectName: import("@oclif/core/lib/interfaces").OptionFlag<string | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        type: import("@oclif/core/lib/interfaces").OptionFlag<import("../../types").DeploymentType>;
        indexerVersion: import("@oclif/core/lib/interfaces").OptionFlag<string | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        queryVersion: import("@oclif/core/lib/interfaces").OptionFlag<string | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        dict: import("@oclif/core/lib/interfaces").OptionFlag<string | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
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
        options: import("@oclif/core/lib/interfaces").OptionFlag<string | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
    };
    static optionMapping: {
        deploy: typeof Deploy;
        promote: typeof Promote;
        delete: typeof Delete;
    };
    run(): Promise<void>;
}
