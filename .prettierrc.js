module.exports = {
  printWidth: 100, // 每行最大字符数
  tabWidth: 2, // 缩进空格数
  useTabs: false, // 使用空格缩进
  semi: true, // 语句末尾加分号
  singleQuote: true, // 使用单引号
  quoteProps: 'as-needed', // 仅在必要时为对象属性加引号
  jsxSingleQuote: false, // JSX 中使用双引号
  trailingComma: 'es5', // 尾随逗号（对象、数组等）
  bracketSpacing: true, // 对象中 { key: value } 保留空格
  bracketSameLine: false, // JSX 多行时，> 不单独换行
  arrowParens: 'always', // 箭头函数参数总是加括号
  endOfLine: 'lf', // 使用 LF 换行符
  embeddedLanguageFormatting: 'auto', // 让 Prettier 自动格式化内嵌代码
};
