import { Command } from '@oclif/core';
import { ProjectNetworkConfig } from '@subql/types-core';
import { ProjectSpecBase } from '../types';
export default class Init extends Command {
    static description: string;
    static flags: {
        force: import("@oclif/core/lib/interfaces").BooleanFlag<boolean>;
        location: import("@oclif/core/lib/interfaces").OptionFlag<string | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        'install-dependencies': import("@oclif/core/lib/interfaces").BooleanFlag<boolean>;
        npm: import("@oclif/core/lib/interfaces").BooleanFlag<boolean>;
        abiPath: import("@oclif/core/lib/interfaces").OptionFlag<string | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
    };
    static args: {
        projectName: import("@oclif/core/lib/interfaces/parser").Arg<string | undefined, Record<string, unknown>>;
    };
    run(): Promise<void>;
    setupProject(project: ProjectSpecBase, projectPath: string, flags: {
        npm: boolean;
        'install-dependencies': boolean;
    }): Promise<{
        isMultiChainProject: boolean;
    }>;
    createProjectScaffold(projectPath: string): Promise<void>;
    extractEndpoints(endpointConfig: ProjectNetworkConfig['endpoint']): string[];
}
