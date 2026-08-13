/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "src",
  setupFiles: ["<rootDir>/__tests__/testUtils/setupEnv.ts"],
  testMatch: ["**/__tests__/**/*.test.ts"],
};
