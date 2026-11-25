module.exports = {
  // Minify formatting and keep Tailwind Play CDN's color syntax for gradients.
  plugins: [
    require('postcss-discard-comments')(),
    require('postcss-normalize-whitespace')(),
  ],
};
