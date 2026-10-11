/** @type {import('@types/eslint').Linter.BaseConfig} */
module.exports = {
  root: true,
  extends: [
    "@remix-run/eslint-config",
    "@remix-run/eslint-config/node",
    "@remix-run/eslint-config/jest-testing-library",
    "prettier",
  ],
  globals: {
    shopify: "readonly"
  },
  // Testene kører med Vitest, ikke Jest. Uden en version kan Jest-reglerne
  // fra Remix' konfiguration slet ikke indlæses.
  settings: { jest: { version: 29 } },
};
