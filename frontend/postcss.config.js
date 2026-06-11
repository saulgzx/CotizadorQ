// CJS: el package.json no declara "type": "module" y el loader de PostCSS
// en Node 18 (CI) no acepta sintaxis ESM en archivos .js.
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
