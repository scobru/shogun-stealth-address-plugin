const path = require('path');
const webpack = require('webpack');

module.exports = {
  mode: 'production',
  entry: './src/index.ts',
  output: {
    path: path.resolve(__dirname, 'dist/browser'),
    filename: 'shogun-stealth-address.js',
    library: {
      name: 'ShogunStealthAddress',
      type: 'umd',
      export: 'default',
    },
    globalObject: 'typeof self !== "undefined" ? self : this',
    umdNamedDefine: true
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
    fallback: {
      "crypto": require.resolve('crypto-browserify'),
      "stream": require.resolve('stream-browserify'),
      "buffer": require.resolve('buffer/'),
      "assert": require.resolve('assert/'),
      "path": require.resolve('path-browserify'),
      "os": require.resolve('os-browserify/browser'),
      "fs": false,
      "net": false,
      "tls": false
    }
  },
  plugins: [
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser'
    })
  ],
  externals: {
    'gun': 'Gun',
    'gun/sea': 'SEA',
    'ethers': 'ethers',
    'shogun-core': 'ShogunCore',
    '@fluidkey/stealth-account-kit': 'FluidkeyStealthAccountKit'
  }
}; 