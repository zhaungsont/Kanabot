# Kanabot



## 專案結構規則

本專案採前後端分離架構，前後端皆使用 TypeScript。

- `frontend/`：前端專案，使用 TypeScript + React。前端相關程式碼、頁面、元件、樣式與前端狀態管理皆放置於此。
- `backend/`：後端專案，使用 Node.js + TypeScript。後端 API、服務邏輯、資料處理與伺服器入口皆放置於此。
- `legacy/`：舊版本專案，除非任務明確要求，否則不需檢視、修改或參考此資料夾內容。

後端開發前，請先進入 `backend/` 目錄並執行：

```bash
nvm use
```


```
KANABOT/
├── backend/                    # 後端專案，使用 Node.js + TypeScript，需依照 .nvmrc 指定版本執行
│   ├── .env                    # 後端環境變數，不提交到 git
│   ├── .env.example            # 後端環境變數範本
│   ├── .nvmrc                  # 後端 Node.js 版本控制檔案
│   ├── package.json            # 後端 Node.js 專案設定
│   ├── tsconfig.json           # 後端 TypeScript 設定
│   └── src/                    # 後端原始碼
│       └── index.ts            # 後端主程式入口
│
├── frontend/                   # 前端專案，使用 TypeScript + React
│   ├── .env                    # 前端環境變數，不提交到 git
│   ├── .env.example            # 前端環境變數範本
│   ├── package.json            # 前端專案設定
│   ├── tsconfig.json           # 前端 TypeScript 設定
│   ├── index.html              # 前端 HTML 入口
│   └── src/                    # 前端原始碼
│       ├── main.tsx            # React 入口
│       └── App.tsx             # React 根元件
│
├── legacy/                     # 舊版本專案，除非特別提及，否則不需檢視
├── .gitignore                  # Git 忽略檔案
├── README.md                   # 使用說明
├── spec.md                     # 專案規格文件
├── CHANGELOG.md                # 版本更新記錄
└── .cursorrules                # Cursor 專案規則
```