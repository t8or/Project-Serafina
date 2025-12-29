import path from 'path';
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

// HTML generation
const generateHTMLPlugins = () =>
  globSync('./src/*.html').map((dir) => {
    const filename = path.basename(dir);
    return new HtmlWebpackPlugin({
      filename,
      template: dir,
      inject: true,
    });
  });

export default {
  mode: "development",
  target: "web",
  entry: "./src/js/index.js",
  devServer: {
    static: {
      directory: path.join(__dirname, "./build"),
    },
    compress: true,
    port: 3000,
    hot: true,
    proxy: [{
      context: ['/api'],
      target: 'http://localhost:3002',
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
