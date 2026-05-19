import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "*.bak",
    "backup/**",
  ]),
  {
    rules: {
      // ห้ามใช้ console.log ใน production code (ใช้ logger แทน)
      // warn เพื่อไม่ให้ break build แต่ให้ทีมรู้
      "no-console": ["warn", { allow: ["warn", "error"] }],

      // จับ unused variables — ป้องกัน dead code
      "no-unused-vars": ["warn", {
        vars: "all",
        args: "after-used",
        ignoreRestSiblings: true,
        argsIgnorePattern: "^_",       // _param ที่ตั้งใจไม่ใช้ → ไม่ warn
        varsIgnorePattern: "^_",
      }],

      // ห้ามใช้ var (ใช้ const/let เท่านั้น)
      "no-var": "error",

      // prefer const ถ้าไม่มีการ reassign
      "prefer-const": ["warn", { destructuring: "all" }],

      // ห้าม empty catch block โดยไม่มี comment
      "no-empty": ["warn", { allowEmptyCatch: false }],

      // ห้าม return ที่คาดไม่ถึงใน async function
      "no-async-promise-executor": "error",

      // ห้ามใช้ await ใน loop แบบ naive (ใช้ Promise.all แทน)
      "no-await-in-loop": "warn",
    },
  },
]);

export default eslintConfig;
