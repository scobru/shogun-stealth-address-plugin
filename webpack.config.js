const path = require("path");
const webpack = require("webpack");

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
    globalObject: 'typeof self !== "undefined" ? self : this',
    umdNamedDefine: true,
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
      crypto: require.resolve("crypto-browserify"),
      stream: require.resolve("stream-browserify"),
      buffer: require.resolve("buffer/"),
      assert: require.resolve("assert/"),
      path: require.resolve("path-browserify"),
      os: require.resolve("os-browserify/browser"),
      fs: false,
      net: false,
      tls: false,
    },
    alias: {
      // Risolvi conflitti di versione tra @noble libraries
      "@noble/hashes": path.resolve(__dirname, "node_modules/@noble/hashes"),
      "@noble/curves": path.resolve(__dirname, "node_modules/@noble/curves"),
      "@noble/secp256k1": path.resolve(
        __dirname,
        "node_modules/@noble/secp256k1"
      ),
      // Reindirizza gli import problematici
      "@noble/hashes/sha2": path.resolve(
        __dirname,
        "node_modules/@noble/hashes/_sha2.js"
      ),
      "@noble/hashes/sha256": path.resolve(
        __dirname,
        "node_modules/@noble/hashes/sha256.js"
      ),
      "@noble/hashes/utils": path.resolve(
        __dirname,
        "node_modules/@noble/hashes/utils.js"
      ),
      "@noble/hashes/hmac": path.resolve(
        __dirname,
        "node_modules/@noble/hashes/hmac.js"
      ),
    },
  },
  plugins: [
    new webpack.ProvidePlugin({
      Buffer: ["buffer", "Buffer"],
      process: "process/browser",
    }),
  ],
  // Rimuoviamo externals per includere tutto nel bundle
  // externals: {
  //   'gun': 'Gun',
  //   'gun/sea': 'SEA',
  //   'ethers': 'ethers',
  //   'shogun-core': 'ShogunCore',
  //   '@fluidkey/stealth-account-kit': 'FluidkeyStealthAccountKit'
  // }
};
