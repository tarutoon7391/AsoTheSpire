// 乱数ユーティリティ
(function createUtilsModule() {
  // 配列をシャッフルする
  function shuffle(array) {
    const cloned = [...array];
    for (let index = cloned.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [cloned[index], cloned[swapIndex]] = [cloned[swapIndex], cloned[index]];
    }
    return cloned;
  }

  // 指定範囲の乱数整数を返す
  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  window.STSUtils = {
    shuffle,
    randomInt
  };
})();
