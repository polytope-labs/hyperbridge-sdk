import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
 preset: 'ts-jest',
 testEnvironment: 'node',
 testMatch: ['**/tests/**/*.test.ts'],
 setupFiles: ['./src/tests/setup.ts'],
 extensionsToTreatAsEsm: ['.ts'],
 moduleNameMapper: {
  '^(\\.{1,2}/.*)\\.js$': '$1',
 },
 transform: {
  '^.+\\.tsx?$': [
   'ts-jest',
   {
    useESM: true,
   },
  ],
 },
 transformIgnorePatterns: [
  'node_modules/(?!(graphql-request|@graphql-typed-document-node)/)',
 ],
};

export default config;
