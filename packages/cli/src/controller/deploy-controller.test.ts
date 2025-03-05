// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import {ROOT_API_URL_PROD} from '../constants';
import {DeploymentDataType, DeploymentType, V3DeploymentIndexerType, ValidateDataType} from '../types';
import {delay} from '../utils';
import {
  createDeployment,
  promoteDeployment,
  deleteDeployment,
  deploymentStatus,
  ipfsCID_validate,
  imageVersions,
  updateDeployment,
  projectsInfo,
} from './deploy-controller';
import {createProject, deleteProject, getProject} from './project-controller';

jest.setTimeout(120000);

const projectSpec = {
  org: process.env.SUBQL_ORG_TEST!,
  projectName: 'mockedStarter',
  ipfs: 'Qmdr4yg98Fv8Yif3anjKVHhjuAKR665j6ekhWsfYUdkaCu',
  subtitle: 'This project is generated by SubQuery SDK integration tests',
  description: '',
  logoURL: '',
  type: 'stage',
};

async function deployTestProject(
  validator: ValidateDataType,
  ipfs: string,
  org: string,
  project_name: string,
  testAuth: string,
  url: string
): Promise<DeploymentDataType> {
  const indexerV = await imageVersions(
    validator.manifestRunner!.node.name,
    validator.manifestRunner!.node.version,
    testAuth,
    url
  );
  const queryV = await imageVersions(
    validator.manifestRunner!.query.name,
    validator.manifestRunner!.query.version,
    testAuth,
    url
  );

  const endpoint = 'wss://polkadot.api.onfinality.io/public-ws';

  const project: V3DeploymentIndexerType = {
    cid: ipfs,
    endpoint,
    indexerImageVersion: indexerV[0],
    indexerAdvancedSettings: {
      indexer: {},
    },
  };

  return createDeployment(
    org,
    project_name,
    testAuth,
    ipfs,
    queryV[0],
    projectSpec.type as DeploymentType,
    {},
    [project],
    url
  );
}

// Replace/Update your access token when test locally
const testAuth = process.env.SUBQL_ACCESS_TOKEN!;
// Can be re-enabled when test env is ready
describe('CLI deploy, delete, promote', () => {
  beforeAll(async () => {
    const {description, logoURL, org, projectName, subtitle} = projectSpec;
    if (!projectSpec.org) {
      throw new Error(`Please set SUBQL_ORG_TEST env var.`);
    }

    const project = await getProject(ROOT_API_URL_PROD, testAuth, `${org}/${projectName}`);
    if (project) {
      console.warn('Project already exists, these tests could be being run in parallel');
      return;
    }
    await createProject(ROOT_API_URL_PROD, testAuth, {
      apiVersion: 'v3',
      key: `${org}/${projectName}`,
      logoUrl: logoURL,
      name: projectName,
      description,
      subtitle,
      tag: [],
      type: 1,
    });
  });

  afterAll(async () => {
    try {
      await deleteProject(testAuth, projectSpec.org, projectSpec.projectName, ROOT_API_URL_PROD);
    } catch (e) {
      console.warn('Failed to delete project', e);
    }
  });

  it('Deploy to Hosted Service and Delete', async () => {
    const {ipfs, org, projectName} = projectSpec;

    const validator = await ipfsCID_validate(ipfs, testAuth, ROOT_API_URL_PROD);
    const deploy_output = await deployTestProject(validator, ipfs, org, projectName, testAuth, ROOT_API_URL_PROD);

    const del_output = await deleteDeployment(org, projectName, testAuth, deploy_output.id, ROOT_API_URL_PROD);
    expect(typeof deploy_output.id).toBe('number');
    expect(+del_output).toBe(deploy_output.id);
  });

  // Only test locally
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('Promote Deployment', async () => {
    const {ipfs, org, projectName} = projectSpec;
    let status: string | undefined;
    let attempt = 0;
    const validator = await ipfsCID_validate(ipfs, testAuth, ROOT_API_URL_PROD);
    const deployOutput = await deployTestProject(validator, ipfs, org, projectName, testAuth, ROOT_API_URL_PROD);
    while (status !== 'running') {
      if (attempt >= 5) break;
      attempt = attempt + 1;
      await delay(30);
      status = await deploymentStatus(org, projectName, testAuth, deployOutput.id, ROOT_API_URL_PROD);
      if (status === 'running') {
        const promoteOutput = await promoteDeployment(org, projectName, testAuth, deployOutput.id, ROOT_API_URL_PROD);
        // eslint-disable-next-line jest/no-conditional-expect
        expect(+promoteOutput).toBe(deployOutput.id);
      }
    }
  });

  it('should return true for valid ipfsCID', async () => {
    const validator = await ipfsCID_validate(projectSpec.ipfs, testAuth, ROOT_API_URL_PROD);
    expect(validator.valid).toBe(true);
  });

  it('to throw error for invalid ipfsCID', async () => {
    await expect(ipfsCID_validate('fake', testAuth, ROOT_API_URL_PROD)).rejects.toThrow(
      'Failed to validate IPFS CID: fake is not a valid subquery deployment id!'
    );
  });

  it('reDeploy to Hosted Service', async () => {
    const {ipfs, org, projectName, type} = projectSpec;
    const newIPFS = 'Qmdr4yg98Fv8Yif3anjKVHhjuAKR665j6ekhWsfYUdkaCu';
    const validator = await ipfsCID_validate(projectSpec.ipfs, testAuth, ROOT_API_URL_PROD);

    const deployOutput = await deployTestProject(validator, ipfs, org, projectName, testAuth, ROOT_API_URL_PROD);
    const initProjectInfo = await projectsInfo(testAuth, org, projectName, ROOT_API_URL_PROD, type);

    const endpoint = 'wss://polkadot.api.onfinality.io/public-ws';
    const indexerV = await imageVersions(
      validator.manifestRunner!.node.name,
      validator.manifestRunner!.node.version,
      testAuth,
      ROOT_API_URL_PROD
    );
    const queryV = await imageVersions(
      validator.manifestRunner!.query.name,
      validator.manifestRunner!.query.version,
      testAuth,
      ROOT_API_URL_PROD
    );

    const project = {
      cid: ipfs,
      endpoint,
      indexerImageVersion: indexerV[0],
      indexerAdvancedSettings: {
        indexer: {},
      },
    };

    await updateDeployment(
      org,
      projectName,
      deployOutput.id,
      testAuth,
      newIPFS,
      queryV[0],
      {},
      [project],
      ROOT_API_URL_PROD
    );
    const updatedInfo = await projectsInfo(testAuth, org, projectName, ROOT_API_URL_PROD, type);

    expect(updatedInfo!.id).toBe(initProjectInfo!.id);
    expect(updatedInfo!.version).not.toEqual(deployOutput.version);
  });
});
