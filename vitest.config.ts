// vitest config — install vitest first: npm install --save-dev vitest
// Then run: npx vitest __tests__/scoring-engine.test.ts
// Without vitest: npx ts-node __tests__/run-tests.ts

export default {
  test: {
    globals:     false,
    environment: "node",
    include:     ["__tests__/**/*.test.ts"],
    reporters:   ["verbose"],
  },
};
