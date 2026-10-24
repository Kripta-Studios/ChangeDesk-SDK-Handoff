const allIn = process.env.CHANGEDESK_ALL_IN === "1";

export default {
  build: {
    lib: { entry: { index: "src/index.ts", storefront: "src/storefront/index.ts" }, formats: ["es"], fileName: (_format: string, entryName: string) => `${entryName}.js`, cssFileName: "storefront" },
    cssCodeSplit: true,
    outDir: allIn ? "dist-all-in" : "dist",
    sourcemap: true,
    rollupOptions: { external: allIn ? ["@changedesk/contracts"] : ["react", "react-dom", "react/jsx-runtime", "@changedesk/contracts"] },
  },
  esbuild: { jsx: "automatic" },
};
