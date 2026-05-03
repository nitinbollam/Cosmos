/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.spec.ts', '<rootDir>/src/**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js'],
  moduleNameMapper: {
    '^\\.\\./\\.\\./generated/prisma-client$': '<rootDir>/src/generated/prisma-client/index.js',
    '^\\.\\./\\.\\./\\.\\./generated/prisma-client$': '<rootDir>/src/generated/prisma-client/index.js',
  },
  transform: {
    '^.+\\.ts$': [
      require.resolve('ts-jest'),
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
}
