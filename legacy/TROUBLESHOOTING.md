# 🛠️ Kanabot 故障排除指南

## 概述

本文檔記錄了 Kanabot 開發過程中遇到的已知問題、解決方案和最佳實踐。

---

## 🚨 關鍵問題

### Mineflayer 聊天功能崩潰問題

#### 問題摘要
- **狀態**: 已確認，等待官方修復
- **嚴重程度**: Critical (關鍵)
- **影響**: 聊天監聽和傳送點系統功能無法使用
- **首次發現**: 2025-01-27

#### 錯誤詳情

**錯誤訊息**:
```
TypeError [ERR_INVALID_ARG_TYPE]: The "list" argument must be an instance of Array. Received an instance of Buffer
    at Function.concat (node:buffer:579:3)
    at updateAndValidateSession (node_modules\minecraft-protocol\src\client\chat.js:61:114)
    at Client.<anonymous> (node_modules\minecraft-protocol\src\client\chat.js:192:55)
```

**觸發條件**:
- Bot 接收到第一次聊天訊息通常正常
- 第二次及後續聊天訊息會導致崩潰
- 問題出現在 minecraft-protocol 的聊天訊息簽名驗證過程

**影響版本**:
- mineflayer: 4.30.0
- minecraft-protocol: 相關依賴版本  
- Node.js: 22.17.1
- Minecraft Server: 1.21

#### 技術分析

**根本原因**:
在 `minecraft-protocol/src/client/chat.js` 第 61 行，`Buffer.concat()` 函數預期接收一個 Buffer 陣列，但實際收到的某些元素可能不是 Buffer 類型。

**問題程式碼**:
```javascript
// minecraft-protocol/src/client/chat.js:61
const acknowledgements = previousMessages.length > 0 ? 
  ['i32', previousMessages.length, 'buffer', 
   Buffer.concat(previousMessages.map(msg => msg.signature || client._signatureCache[msg.id]))] 
  : ['i32', 0]
```

#### 解決方案

##### 方案 1: 暫時停用聊天監聽器 (目前採用)

**實作**:
```javascript
// 暫時註解掉聊天監聽器
// bot.on('chat', (username, message) => {
//     if (username === bot.username) return;
//     log('info', `💬 聊天訊息 - ${username}: ${message}`);
//     handleTeleportCommands(bot, username, message);
// });
```

**優點**:
- ✅ 確保 bot 穩定性
- ✅ 其他功能正常運作
- ✅ 無需修改第三方庫

**缺點**:
- ❌ 失去聊天互動功能
- ❌ 傳送點系統無法使用

##### 方案 2: 修補 minecraft-protocol 庫

**實作**:
修改 `node_modules/minecraft-protocol/src/client/chat.js` 第 61 行為：

```javascript
const acknowledgements = previousMessages.length > 0 ? 
  ['i32', previousMessages.length, 'buffer', 
   Buffer.concat(previousMessages.map(msg => msg.signature || client._signatureCache[msg.id])
   .filter(buf => Buffer.isBuffer(buf)))] 
  : ['i32', 0]
```

**關鍵變更**: 新增 `.filter(buf => Buffer.isBuffer(buf))` 過濾非 Buffer 元素

**優點**:
- ✅ 恢復聊天功能
- ✅ 傳送點系統可正常使用
- ✅ 修復核心問題

**缺點**:
- ❌ 每次 `npm install` 後需重新應用
- ❌ 可能影響其他功能的穩定性
- ❌ 非官方修復，可能引入新問題

##### 方案 3: 版本降級

**實作**:
```bash
npm install mineflayer@4.29.0  # 使用較舊但穩定的版本
```

**優點**:
- ✅ 避免已知問題
- ✅ 保持聊天功能
- ✅ 官方支援的版本

**缺點**:
- ❌ 無法使用最新功能
- ❌ 可能缺少安全性修復
- ❌ 長期不可持續

#### 風險評估

| 方案 | 穩定性 | 功能完整性 | 維護成本 | 推薦指數 |
|------|--------|------------|----------|----------|
| 停用聊天 | 🟢 高 | 🔴 低 | 🟢 低 | ⭐⭐⭐ |
| 修補庫 | 🟡 中 | 🟢 高 | 🔴 高 | ⭐⭐ |
| 版本降級 | 🟢 高 | 🟡 中 | 🟡 中 | ⭐⭐ |

#### 監控與更新

**相關資源**:
- 🔗 [原始 GitHub Issue](https://github.com/PrismarineJS/mineflayer/issues/3703)
- 🔗 [Mineflayer 官方倉庫](https://github.com/PrismarineJS/mineflayer)
- 🔗 [Minecraft-protocol 倉庫](https://github.com/PrismarineJS/node-minecraft-protocol)

**監控狀態**:
- ⏳ 等待官方修復發布
- 📋 問題已記錄在專案文檔
- 🔍 定期檢查相關 issue 更新

**建議行動**:
1. 定期檢查 mineflayer 新版本發布
2. 測試新版本是否修復此問題
3. 一旦官方修復，立即更新並恢復聊天功能

---

## 📞 獲得幫助

如果遇到其他問題：

1. **檢查已知問題**: 首先查看此文檔
2. **查看日誌**: 檢查控制台輸出中的錯誤訊息
3. **搜尋社群**: 在 mineflayer GitHub Issues 中搜尋相似問題
4. **版本相容性**: 確認 Node.js、mineflayer 版本相容性

---

## 📝 貢獻

發現新問題或解決方案？請：
1. 更新此文檔記錄問題
2. 在 spec.md 中更新版本歷史
3. 考慮向上游專案報告問題

---

*最後更新: 2025-01-27* 