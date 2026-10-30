Once my containing folder changes, please update me.
纯逻辑层：拼音索引、搜索、名单状态和持久化，不依赖 DOM，浏览器和 Node 均可加载。
`pinyin-keys.js` 姓名→拼音音节（多音字/ü）· `matcher.js` 搜索排序 · `roster.js` 名单解析与不可变状态变更/CSV · `store.js` localStorage 主存储+滚动快照 · `sky.js` 星空大屏的星位布局与点亮数量
