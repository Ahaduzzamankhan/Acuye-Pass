module.exports = {
  root: true,
  extends: "@react-native",
  rules: {
    quotes: ["warn", "double", { avoidEscape: true }],
    curly: ["warn", "multi-line"],
    "no-void": "off",
  },
};
