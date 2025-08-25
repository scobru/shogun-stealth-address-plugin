const path = require("path");

module.exports = {
  mode: "production",
  entry: "./src/index.ts",
  output: {
    path: path.resolve(__dirname, "dist/browser"),
    filename: "shogun-stealth-address.js",
    library: {
      name: "ShogunStealthAddress",
      type: "umd",
      export: "default",
    },
    globalObject: "this",
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: [".ts", ".js"],
    fallback: {
      buffer: require.resolve("buffer"),
      crypto: require.resolve("crypto-browserify"),
      stream: require.resolve("stream-browserify"),
      path: require.resolve("path-browserify"),
      os: require.resolve("os-browserify/browser"),
      process: require.resolve("process/browser"),
    },
  },
  plugins: [
    // Plugin per definire variabili globali
    new (require("webpack").DefinePlugin)({
      "process.env": {},
      global: "globalThis",
    }),
    // Plugin per fornire polyfill
    new (require("webpack").ProvidePlugin)({
      Buffer: ["buffer", "Buffer"],
      process: "process/browser",
    }),
  ],
  // externals: {
  //   gun: "Gun",
  //   "gun/sea": "SEA",
  //   ethers: "ethers",
  //   "shogun-core": "ShogunCore",
  //   "@fluidkey/stealth-account-kit": "generateEphemeralPrivateKey",
  // },
};
