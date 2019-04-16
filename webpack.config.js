const path = require('path')
const nodeExternals = require('webpack-node-externals')
const CleanWebpackPlugin = require('clean-webpack-plugin')
const webpackMerge = require('webpack-merge')
const NodemonPlugin = require('nodemon-webpack-plugin')

const config = {
  // Common config shared by all enviorments
  common: {
    output: {
      path: path.resolve(__dirname, 'lib'),
      filename: '[name].js',
      library: '',
      libraryTarget: 'commonjs2',
    },
    entry: {
      index: path.resolve(__dirname, 'src/index.ts'),
    },
    module: {
      rules: [
        {
          // Transpiles ES6-8 into ES5
          test: /\.(js|ts)$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
          },
        },
      ],
    },
    resolve: {
      extensions: ['*', '.js', '.ts'],
    },
    plugins: [new CleanWebpackPlugin()],
    externals: [
      nodeExternals({
        modulesFromFile: true,
      }),
    ],
  },
  // Development specific config
  development: {
    mode: 'development',
    entry: {
      server: path.resolve(__dirname, 'usage/Server.ts'),
    },
    plugins: [
      new NodemonPlugin({
        script: 'lib/server.js',
      }),
    ],
    module: {
      rules: [
        {
          enforce: 'pre',
          test: /\.(ts)$/,
          loader: 'tslint-loader',
          exclude: /(node_modules)/,
          options: {
            emitWarning: true,
          },
        },
      ],
    },
    target: 'node',
    devtool: 'source-map',
  },
  // Production specific config
  production: {
    mode: 'production',
  },
}

module.exports = webpackMerge(
  config.common,
  config[process.env.NODE_ENV || 'production']
)
