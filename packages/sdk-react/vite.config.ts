export default {
  build: {
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "index" },
    sourcemap: true,
    rollupOptions: { external: ["react", "react-dom", "react/jsx-runtime", "@changedesk/contracts"] },
  },
  esbuild: { jsx: "automatic" },
};
