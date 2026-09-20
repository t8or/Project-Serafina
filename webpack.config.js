import path from 'path';
import dotenv from 'dotenv';
dotenv.config({quiet: true});
import { fileURLToPath } from 'url';
import { globSync } from 'glob';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import autoprefixer from 'autoprefixer';

console.log('Webpack config loading...');
console.log('Node version:', process.version);
console.log('Module type:', import.meta.url ? 'ESM' : 'CommonJS');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INCLUDE_PATTERN =
  /<include\s+src=["'](.+?)["']\s*\/?>\s*(?:<\/include>)?/gis;

const processNestedHtml = (content, loaderContext, dir = null) =>
  !INCLUDE_PATTERN.test(content)
    ? content
    : content.replace(INCLUDE_PATTERN, (m, src) => {
        const filePath = path.resolve(dir || loaderContext.context, src);
        loaderContext.dependency(filePath);
        return processNestedHtml(
          loaderContext.fs.readFileSync(filePath, "utf8"),
          loaderContext,
          path.dirname(filePath),
        );
      });

const APP_HTML_FILES = new Set([
  'index.html',
  'dashboard.html',
  'file-upload.html',
  'scorecard-config.html',
  'content.html',
  'reports.html',
  'reference-inputs.html',
  '404.html',
]);

// Only ship the Serafina product surfaces. The remaining source pages are
// TailAdmin references and should not be reachable in the local application.
const generateHTMLPlugins = () =>
  globSync('./src/*.html').filter((dir) => APP_HTML_FILES.has(path.basename(dir))).map((dir) => {
    const filename = path.basename(dir);
    return new HtmlWebpackPlugin({
      filename,
      template: dir,
      inject: true,
    });
  });

export default {
  mode: process.env.NODE_ENV === 'development' ? 'development' : 'production',
  target: "web",
  entry: "./src/js/index.js",
  devServer: {
    static: {
      directory: path.join(__dirname, "./build"),
    },
    compress: true,
    host: "127.0.0.1",
    port: 3001,
    hot: true,
    proxy: [{
      context: ['/api', '/uploads'],
      target: `http://127.0.0.1:${process.env.PORT || 3000}`,
      secure: false,
      changeOrigin: true
    }]
  },
  stats: {
    modules: true,
    reasons: true,
    moduleTrace: true,
    errorDetails: true
  },
  performance: {
    hints: process.env.NODE_ENV === 'production' ? 'warning' : false,
    // ApexCharts is intentionally lazy-loaded as a separate dashboard-only
    // chunk; keep the initial entrypoint budget strict while allowing it.
    maxAssetSize: 600_000,
    maxEntrypointSize: 300_000,
  },
  module: {
    rules: [
      {
        test: /\.m?js$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: {
            presets: ["@babel/preset-env"],
          },
        },
      },
      {
        test: /\.css$/,
        use: [
          MiniCssExtractPlugin.loader,
          "css-loader",
          {
            loader: "postcss-loader",
            options: {
              postcssOptions: {
                plugins: [
                  autoprefixer({
                    overrideBrowserslist: ["last 2 versions"],
                  }),
                ],
              },
            },
          },
        ],
      },
      {
        test: /\.(png|svg|jpg|jpeg|gif)$/i,
        type: "asset/resource",
      },
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: "asset/resource",
      },
      {
        test: /\.html$/,
        use: [
          {
            loader: "html-loader",
            options: {
              preprocessor: processNestedHtml,
            },
          },
        ],
      },
    ],
  },
  plugins: [
    ...generateHTMLPlugins(),
    new MiniCssExtractPlugin({
      filename: "css/[name].css",
      chunkFilename: "css/[id].css",
    }),
  ],
  output: {
    filename: "js/[name].bundle.js",
    path: path.resolve(__dirname, "build"),
    clean: true,
    publicPath: "/",
    assetModuleFilename: "assets/[name][ext]",
    chunkFormat: "array-push",
    environment: {
      arrowFunction: true,
      bigIntLiteral: false,
      const: true,
      destructuring: true,
      dynamicImport: false,
      forOf: true,
      module: true,
      optionalChaining: true,
      templateLiteral: true
    }
  },
  resolve: {
    extensions: ['.js', '.mjs', '.css', '.json'],
    extensionAlias: {
      '.js': ['.js', '.mjs']
    },
    modules: ['node_modules'],
  },
};
