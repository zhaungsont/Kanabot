# Changelog

## [1.2.2] - 2025-01-27

### 🚨 Critical Issue Discovered
- **發現**: Mineflayer 4.30.0 聊天功能崩潰問題 (issue #3703)
- **影響**: 聊天監聽和傳送點系統暫時無法使用
- **狀態**: 已暫時停用聊天功能確保 bot 穩定性

### 📝 Documentation
- **新增**: 完整的 `TROUBLESHOOTING.md` 故障排除指南
- **更新**: `README.md` 加入故障排除章節和解決方案
- **更新**: `spec.md` 記錄已知問題與限制
- **記錄**: 社群提供的臨時修復方案

### 🔍 Technical Details
- **根本原因**: minecraft-protocol 庫的 Buffer.concat 類型錯誤
- **臨時修復**: 提供了 node_modules 修補方案
- **風險評估**: 完整分析各種解決方案的利弊
- **監控**: 持續關注官方修復進度

### 📋 References
- [Mineflayer Issue #3703](https://github.com/PrismarineJS/mineflayer/issues/3703)
- 感謝社群貢獻的修復方案

## [1.2.1] - 2025-01-27

### 安全性修正
- 改用模組級別的 `teleportDestinations` Map 存儲傳送點
- 改用 `WeakSet` 記錄 tick 錯誤狀態，取代 `bot._tickErrorLogged` 屬性
- 移除對 bot 實例屬性的直接修改，避免與 mineflayer 內部屬性衝突
- 提升程式碼安全性，防止意外覆蓋 bot 原生屬性

---

*格式基於 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)，並且本專案遵守 [語意化版本](https://semver.org/lang/zh-TW/)。*

## [1.0.0] - 2025-01-27

### 新增
- 🎉 初版發布 - AIK Minecraft Bot
- ✅ Microsoft 帳號認證系統
- ✅ 自動 Minecraft 版本偵測 (支援 1.8 - 1.21)
- ✅ 基本聊天功能 (登入後自動發送 "hello world")
- ✅ 智能錯誤處理和自動重連機制
- ✅ 結構化日誌系統 (時間戳 + 等級)
- ✅ 環境變數配置支援 (.env + env.example)
- ✅ ES Modules 模組系統支援
- ✅ Node.js 22+ 支援
- ✅ .nvmrc 檔案版本控制
- ✅ nodemon 開發模式自動重啟功能
- ✅ 擴展的 npm 腳本支援 (dev, clean, reinstall)
- ✅ 跨平台相容性 (Windows, macOS, Linux)

### 技術規格
- **框架**: mineflayer 4.30.0
- **認證**: Microsoft Account OAuth
- **環境**: Node.js 22.17.1 (透過 .nvmrc 指定)
- **模組**: ES Modules (import/export)
- **配置**: 環境變數 (.env)
- **版本控制**: .nvmrc 確保開發環境一致性

### 功能特色
- 🔐 安全的 Microsoft 認證流程
- 🔄 自動版本判斷，無需手動設定
- 📝 詳細的日誌記錄和錯誤追蹤
- 🔄 網路中斷時自動重連
- 🛡️ 強化的錯誤處理機制
- ⚙️ 靈活的環境變數配置
- 🚀 nodemon 開發模式提升開發體驗

### 文檔
- 📖 完整的 README.md 使用說明
- 📋 詳細的 spec.md 技術規格
- 🔧 .cursorrules 開發規範
- 📝 env.example 配置範本

### 安全性
- 🔒 密碼和敏感資訊不在程式碼中硬編碼
- 🚫 .env 檔案自動忽略版本控制
- 🛡️ 日誌中不記錄敏感資訊

---

## 規劃中功能

### [1.1.0] - 計劃中
- [ ] 更多聊天指令支援
- [ ] 配置檔案支援 (JSON/YAML)
- [ ] 詳細錯誤分類和狀態碼
- [ ] 聊天訊息過濾和回應機制

### [1.2.0] - 計劃中
- [ ] Web 管理介面
- [ ] 多伺服器同時連接支援
- [ ] 基本插件系統架構
- [ ] 效能監控和統計

### [2.0.0] - 長期規劃
- [ ] TypeScript 完全重構
- [ ] 資料庫支援 (SQLite/PostgreSQL)
- [ ] 叢集部署和負載平衡
- [ ] 進階 AI 聊天機器人整合

---

## 版本說明

本專案使用語意化版本 (Semantic Versioning):
- **主版本號 (Major)**: 不相容的 API 修改
- **次版本號 (Minor)**: 新增功能且向下相容
- **修訂號 (Patch)**: 向下相容的問題修正

## 支援與回饋

如果您發現問題或有建議，請：
1. 檢查已知問題列表
2. 搜尋現有的 Issues
3. 建立新的 Issue 或 Feature Request

感謝您的使用和回饋！ 