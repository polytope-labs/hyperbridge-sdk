import { Command } from '@oclif/core';
export interface SelectedMethod {
    name: string;
    method: string;
}
export interface UserInput {
    startBlock: number;
    functions: SelectedMethod[];
    events: SelectedMethod[];
    abiPath: string;
    address?: string;
}
export default class Generate extends Command {
    static description: string;
    static flags: {
        file: import("@oclif/core/lib/interfaces").OptionFlag<string | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        events: import("@oclif/core/lib/interfaces").OptionFlag<string | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        functions: import("@oclif/core/lib/interfaces").OptionFlag<string | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        abiPath: import("@oclif/core/lib/interfaces").OptionFlag<string, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        startBlock: import("@oclif/core/lib/interfaces").OptionFlag<number, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
        address: import("@oclif/core/lib/interfaces").OptionFlag<string | undefined, import("@oclif/core/lib/interfaces/parser").CustomOptions>;
    };
    private prepareUserInput;
    run(): Promise<void>;
}
