# Allan Learning System — 國字練習 v3.0.0

純前端、可離線使用的國字練習 PWA，目前收錄小一下至小三下，共 60 課、964 筆生字。

## 執行

可部署至 GitHub Pages；本機測試建議在專案根目錄執行：

```bash
python -m http.server 8000
```

再開啟 `http://localhost:8000/`。

## 資料檔

- `database/g1s2.js`：小一下
- `database/g2s1.js`：小二上
- `database/g2s2.js`：小二下
- `database/g3s1.js`：小三上
- `database/g3s2.js`：小三下
- `database/index.js`：匯整與正規化

舊版的 `data_g1_tog31.js` 與 `data_v2.js` 已移除，避免重複載入。
