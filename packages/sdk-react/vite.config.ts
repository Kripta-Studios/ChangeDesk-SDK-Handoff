const allIn = process.env.CHANGEDESK_ALL_IN === "1";

export default {
  build: {
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "index" },
    cssCodeSplit: true,
    outDir: allIn ? "dist-all-in" : "dist",
    sourcemap: true,
    rollupOptions: { external: allIn ? ["@changedesk/contracts"] : ["react", "react-dom", "react/jsx-runtime", "@changedesk/contracts"] },
  },
  esbuild: { jsx: "automatic" },
};
