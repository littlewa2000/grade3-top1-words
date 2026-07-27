# Database Schema

每個學期檔案註冊一個 dataset：

```js
{
  grade: "小學三年級下學期",
  gradeCode: "小三下",
  lessons: [{
    id: "G3B-L01",
    lessonNo: 1,
    title: "第1課",
    words: [{
      id: "3-2-01-01",
      字: "撐",
      注音: "ㄔㄥ",
      words: ["撐傘", "撐船", "支撐", "撐住"],
      sentences: [],
      radical: null,
      strokes: null
    }]
  }]
}
```

`database/index.js` 會補上相容欄位：`char`、`zhuyin`、`grade`、`semester`、`lesson`、`term`。
