const { MetadataStorage } = require("@medusajs/framework/mikro-orm/core")
const { readFileSync } = require("node:fs")
const Module = require("node:module")
const { dirname, resolve } = require("node:path")
const { transformSync } = require("@swc/core")

MetadataStorage.clear()

// canonicalize@5.1.0 is ESM-only, while Medusa 2.22 test-utils synchronously
// require()s configured plugin modules. Compile the pinned package source in
// memory for this Jest process; production continues to import its ESM entry.
// Jest patches even Module.createRequire().resolve through moduleNameMapper.
// Address the workspace's pinned dependency by file and verify its manifest
// before compiling, avoiding both the mapper recursion and an unpinned copy.
const canonicalizeDir = resolve(__dirname, "../../../packages/medusa-plugin/node_modules/canonicalize")
const canonicalizeManifest = JSON.parse(readFileSync(resolve(canonicalizeDir, "package.json"), "utf8"))
if (canonicalizeManifest.name !== "canonicalize" || canonicalizeManifest.version !== "5.1.0") throw new Error("unexpected canonicalize test dependency")
const canonicalizePath = resolve(canonicalizeDir, "lib/canonicalize.js")
if (canonicalizePath === __filename) throw new Error("canonicalize test mapper resolved recursively")
const transformed = transformSync(readFileSync(canonicalizePath, "utf8"), {
  filename: canonicalizePath,
  jsc: { parser: { syntax: "ecmascript" }, target: "es2022" },
  module: { type: "commonjs" },
}).code
const canonicalizeModule = new Module(canonicalizePath, module)
canonicalizeModule.filename = canonicalizePath
canonicalizeModule.paths = Module._nodeModulePaths(dirname(canonicalizePath))
canonicalizeModule._compile(transformed, canonicalizePath)
module.exports = canonicalizeModule.exports.default
