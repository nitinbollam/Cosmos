/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.spec.ts', '**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js'],
  rootDir: './src',
  collectCoverageFrom: ['**/*.ts', '!main.ts', '!**/*.module.ts', '!**/dto/**'],
}
