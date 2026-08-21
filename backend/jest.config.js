/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "src",
  setupFiles: ["<rootDir>/__tests__/testUtils/setupEnv.ts"],
  setupFilesAfterEnv: ["<rootDir>/__tests__/testUtils/setupTests.ts"],
  testMatch: ["**/__tests__/**/*.test.ts"],
};
