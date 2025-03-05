import { CreateProject, ProjectDataType } from '../types';
interface CreateProjectResponse {
    key: string;
}
export declare const suffixFormat: (value: string) => string;
export declare function getProject(url: string, authToken: string, key: string): Promise<ProjectDataType | undefined>;
export declare function createProject(url: string, authToken: string, body: CreateProject): Promise<CreateProjectResponse>;
export declare function deleteProject(authToken: string, organization: string, project_name: string, url: string): Promise<string>;
export {};
