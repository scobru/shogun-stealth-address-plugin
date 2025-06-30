const path = require('path');

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
    globalObject: 'this'
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
  },
  externals: {
    'gun': 'Gun',
    'gun/sea': 'SEA',
    'ethers': 'ethers',
    'shogun-core': 'ShogunCore'
  }
}; 