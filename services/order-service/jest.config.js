/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: './src',
  testMatch: ['**/__tests__/**/*.spec.ts', '**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js'],
  collectCoverageFrom: [
    '**/*.ts',
    '!main.ts',
    '!**/*.module.ts',
    '!**/dto/**',
    '!**/generated/**',
  ],
  coverageThreshold: {
    '**/order/order.saga.ts': {
      statements: 85,
      branches: 60,
      lines: 85,
      functions: 55,
    },
  },
}
