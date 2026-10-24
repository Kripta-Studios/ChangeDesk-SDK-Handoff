const { MetadataStorage } = require("@medusajs/framework/mikro-orm/core")
const { readFileSync } = require("node:fs")
const Module = require("node:module")
const { dirname } = require("node:path")
const { transformSync } = require("@swc/core")

MetadataStorage.clear()

// canonicalize@5.1.0 is ESM-only, while Medusa 2.22 test-utils synchronously
// require()s configured plugin modules. Compile the pinned package source in
// memory for this Jest process; production continues to import its ESM entry.
const canonicalizePath = require.resolve("canonicalize")
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
