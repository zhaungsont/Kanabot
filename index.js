import mineflayer from 'mineflayer';
import dotenv from 'dotenv';
import { loader as autoEat } from 'mineflayer-auto-eat';

// 載入環境變數
dotenv.config();

/**
 * Minecraft Bot 配置
 */
const config = {
	host: process.env.MINECRAFT_SERVER_HOST || 'localhost',
	port: process.env.MINECRAFT_SERVER_PORT
		? parseInt(process.env.MINECRAFT_SERVER_PORT)
		: 25565,
	username: process.env.MINECRAFT_EMAIL, // Microsoft 認證使用 email 作為 username
	auth: 'microsoft', // 使用 Microsoft 認證
	// version: false, // 自動判斷版本（讓 mineflayer 自動偵測）
};

console.log(config);

/**
 * 日誌函式
 */
function log(level, message) {
	const timestamp = new Date().toISOString();
	console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
}

/**
 * 驗證必要的環境變數
 */
function validateConfig() {
	log('info', '🔍 正在驗證配置...');

	if (!config.username) {
		log('error', '❌ 缺少必要的環境變數設定！');
		log('info', '');
		log('info', '💡 請按照以下步驟設定:');
		log('info', '1️⃣  確保 .env 檔案存在於專案根目錄');
		log(
			'info',
			'2️⃣  在 .env 檔案中設定: MINECRAFT_EMAIL=your-microsoft-email@example.com'
		);
		log('info', '3️⃣  確保您的 Microsoft 帳號擁有 Minecraft Java Edition');
		log('info', '');
		log('info', '📝 您可以參考 env.example 檔案來設定環境變數');
		log('info', '🔐 Microsoft 認證將會自動開啟瀏覽器進行登入流程');
		log('info', '');
		process.exit(1);
	}

	log('info', '✅ 配置驗證通過！');
	log('info', '');
	log('info', '📊 Bot 配置資訊:');
	log('info', `   🤖 Bot 用戶名: ${config.username}`);
	log('info', `   🌐 目標伺服器: ${config.host}:${config.port}`);
	log('info', `   🔐 認證方式: ${config.auth}`);
	log('info', '');
}

function initAutoEat(bot) {
	bot.loadPlugin(autoEat);
	bot.autoEat.enableAuto();

	bot.autoEat.on('eatStart', (opts) => {
		console.log(
			`Started eating ${opts.food.name} in ${opts.offhand ? 'offhand' : 'hand'}`
		);
	});

	bot.autoEat.on('eatFinish', (opts) => {
		console.log(`Finished eating ${opts.food.name}`);
		console.log(`food: ${bot.food}`);
		console.log(`food saturation: ${bot.foodSaturation}`);
	});

	bot.autoEat.on('eatFail', (error) => {
		console.error('Eating failed:', error);
	});
}

/**
 * 建立並配置 Minecraft Bot
 */
function createBot() {
	log('info', '正在建立 Minecraft Bot...');
	log('info', '='.repeat(50));
	log('info', '🔐 Microsoft 認證流程說明:');
	log('info', '1. 系統將會開啟瀏覽器或顯示認證代碼');
	log('info', '2. 請在瀏覽器中登入您的 Microsoft 帳號');
	log('info', '3. 完成認證後，Bot 將自動連接到伺服器');
	log('info', '4. 認證資訊會被快取，下次啟動時會自動使用');
	log('info', '='.repeat(50));

	const bot = mineflayer.createBot(config);

	// Microsoft 認證相關事件
	bot.on('session', (session) => {
		log('info', '✅ Microsoft 認證成功！');
		log('info', `認證用戶: ${session.username || 'Unknown'}`);
		log('info', '認證資訊已快取，下次啟動將自動使用');
	});

	// 當 bot 成功登入時
	bot.on('spawn', () => {
		log('info', '🎉 Bot 已成功登入並生成在世界中！');
		log('info', `📍 目前位置: ${bot.entity.position}`);
		log('info', `🎮 遊戲版本: ${bot.version}`);
		log('info', `🏠 伺服器: ${config.host}:${config.port}`);

		// bot.autoEat.options.startAt = 19;
		initAutoEat(bot);

		// 等待一秒後發送 hello world 訊息
		setTimeout(() => {
			bot.chat('hello world');
			log('info', '💬 已發送 "hello world" 訊息到聊天頻道');
		}, 1000);

		// 啟用持續看向最近玩家功能
		log('info', '👁️ 啟用持續看向最近玩家功能');
	});

	// 統一的 tick 事件監聽器 - 可擴展其他需要 tick 的功能
	bot.on('physicsTick', () => {
		try {
			// 持續看向最近玩家功能
			lookAtNearestPlayer(bot);

			// 未來可在此處加入其他需要 tick 觸發的功能
			// 例如：checkHealth(bot);
			// 例如：updateStatus(bot);
		} catch (error) {
			// 避免在 tick 事件中拋出錯誤影響 bot 運作
			if (!tickErrorLoggedBots.has(bot)) {
				log('error', `⚡ Tick 事件處理發生錯誤: ${error.message}`);
				tickErrorLoggedBots.add(bot);
			}
		}
	});

	log('info', '✅ 持續看向最近玩家功能已啟用');

	// 監聽聊天訊息
	bot.on('chat', (username, message) => {
		if (username === bot.username) return; // 忽略自己的訊息
		bot.chat(message);
		log('info', `💬 聊天訊息 - ${username}: ${message}`);

		// 處理傳送相關的聊天指令
		handleTeleportCommands(bot, username, message);
	});

	// 當 bot 被踢出時
	bot.on('kicked', (reason) => {
		log('error', `❌ Bot 被踢出伺服器: ${reason}`);
		log('info', '💡 請檢查踢出原因，必要時可手動重新啟動 Bot');
	});

	// 錯誤處理
	bot.on('error', (err) => {
		log('error', `❌ Bot 發生錯誤: ${err.message}`);

		// Microsoft 認證相關錯誤
		if (
			err.message.includes('Invalid credentials') ||
			err.message.includes('Unauthorized')
		) {
			log('error', '🔐 Microsoft 認證失敗');
			log('info', '💡 可能的解決方案:');
			log(
				'info',
				'   1. 檢查您的 Microsoft 帳號是否擁有 Minecraft Java Edition'
			);
			log('info', '   2. 確認網路連線正常');
			log('info', '   3. 嘗試重新認證（清除快取後重新啟動）');
			log('info', '   4. 檢查 MINECRAFT_EMAIL 是否正確設定');
			return; // 不自動重試認證錯誤
		}

		// 伺服器連線錯誤
		if (
			err.message.includes('connect ECONNREFUSED') ||
			err.code === 'ECONNREFUSED'
		) {
			log('error', '🌐 無法連接到 Minecraft 伺服器');
			log('info', '💡 這是正常的，如果您沒有在本地運行 Minecraft 伺服器');
			log('info', '💡 您可以:');
			log(
				'info',
				'   1. 在 .env 中設定 MINECRAFT_SERVER_HOST 為有效的伺服器地址'
			);
			log('info', '   2. 啟動本地 Minecraft 伺服器');
			log('info', '   3. 或使用公開的測試伺服器');
			log('info', '💡 請修正設定後手動重新啟動 Bot');
			return;
		}

		// 其他錯誤
		log('info', '💡 請檢查錯誤訊息，必要時可手動重新啟動 Bot');
	});

	// 當連接結束時
	bot.on('end', () => {
		log('info', '🔌 與伺服器的連接已斷開');
	});

	// 登入過程的詳細日誌
	bot.on('login', () => {
		log('info', '🔑 正在登入伺服器...');
	});

	return bot;
}

/**
 * 持續看向最近玩家的功能
 * @param {Object} bot - mineflayer bot 實例
 */
function lookAtNearestPlayer(bot) {
	const playerEntity = bot.nearestEntity((entity) => {
		return entity.type === 'player' || entity.type === 'mob';
	});

	if (!playerEntity) return;

	const pos = playerEntity.position.offset(0, playerEntity.height * 0.9, 0);
	bot.lookAt(pos);
}

// ============== 傳送點系統 ==============

/**
 * 全域傳送點存儲 - 避免污染 bot 實例
 * @type {Map<string, Object>}
 */
const teleportDestinations = new Map();

/**
 * 記錄已顯示 tick 錯誤的 bot 實例 - 避免污染 bot 實例
 * @type {WeakSet<Object>}
 */
const tickErrorLoggedBots = new WeakSet();

/**
 * 解析傳送點註冊指令
 * @param {string} message - 聊天訊息
 * @returns {Object|null} 解析結果 { x, y, z, name } 或 null
 */
function parseTeleportRegisterCommand(message) {
	// 指令格式: "bot register tp <x> <y> <z> <name>"
	console.log('parseTeleportRegisterCommand', message);
	const regex =
		/^bot\s+register\s+tp\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(\S+)$/i;
	const match = message.trim().match(regex);

	console.log('parseTeleportRegisterCommand match', match);
	if (!match) {
		return null;
	}

	const [, xStr, yStr, zStr, name] = match;

	// 驗證座標值
	const x = parseFloat(xStr);
	const y = parseFloat(yStr);
	const z = parseFloat(zStr);

	console.log('parseTeleportRegisterCommand 1', { xStr, yStr, zStr, name });

	if (isNaN(x) || isNaN(y) || isNaN(z)) {
		return null;
	}
	console.log('parseTeleportRegisterCommand 2', { x, y, z, name });
	return { x, y, z, name };
}

/**
 * 註冊傳送點
 * @param {Object} bot - mineflayer bot 實例
 * @param {number} x - X 座標
 * @param {number} y - Y 座標
 * @param {number} z - Z 座標
 * @param {string} name - 傳送點名稱
 * @param {string} playerName - 註冊的玩家名稱
 */
function registerTeleportDestination(bot, x, y, z, name, playerName) {
	const nameKey = name.toLowerCase();
	const destinationData = {
		x: x,
		y: y,
		z: z,
		originalName: name,
		registeredBy: playerName,
		registeredAt: new Date().toISOString(),
	};

	// 檢查是否已存在
	const wasExisting = teleportDestinations.has(nameKey);

	// 註冊傳送點
	teleportDestinations.set(nameKey, destinationData);

	// 記錄日誌
	if (wasExisting) {
		log('info', `🔄 傳送點已更新: ${name} (${x}, ${y}, ${z}) by ${playerName}`);
		bot.chat(`✅ 傳送點 "${name}" 已更新為座標 (${x}, ${y}, ${z})`);
	} else {
		log(
			'info',
			`✅ 新傳送點已註冊: ${name} (${x}, ${y}, ${z}) by ${playerName}`
		);
		bot.chat(`✅ 傳送點 "${name}" 已註冊到座標 (${x}, ${y}, ${z})`);
	}
}

/**
 * 解析傳送指令
 * @param {string} message - 聊天訊息
 * @returns {string|null} 傳送點名稱或 null
 */
function parseTeleportCommand(message) {
	// 指令格式: "bot tp <name>"
	const regex = /^bot\s+tp\s+(\S+)$/i;
	const match = message.trim().match(regex);

	if (!match) {
		return null;
	}

	return match[1]; // 回傳傳送點名稱
}

/**
 * 執行傳送到指定目的地
 * @param {Object} bot - mineflayer bot 實例
 * @param {string} destinationName - 目的地名稱
 * @param {string} playerName - 請求傳送的玩家名稱
 */
function teleportToDestination(bot, destinationName, playerName) {
	const nameKey = destinationName.toLowerCase();
	const destination = teleportDestinations.get(nameKey);

	if (!destination) {
		log(
			'info',
			`❌ 傳送失敗: 找不到傳送點 "${destinationName}" (請求者: ${playerName})`
		);
		bot.chat(
			`❌ 找不到傳送點 "${destinationName}"。使用 "bot register tp <x> <y> <z> <name>" 來註冊新的傳送點。`
		);
		return;
	}

	const { x, y, z, originalName } = destination;

	// 執行傳送指令
	const teleportCommand = `/tp ${x} ${y} ${z}`;
	bot.chat(teleportCommand);

	// 記錄日誌和回應
	log(
		'info',
		`🚀 執行傳送: ${originalName} (${x}, ${y}, ${z}) 請求者: ${playerName}`
	);
	bot.chat(`🚀 正在傳送到 "${originalName}" (${x}, ${y}, ${z})`);
}

/**
 * 處理傳送相關的聊天指令
 * @param {Object} bot - mineflayer bot 實例
 * @param {string} username - 發送訊息的玩家名稱
 * @param {string} message - 聊天訊息內容
 * @returns {boolean} 是否處理了傳送指令
 */
function handleTeleportCommands(bot, username, message) {
	// 忽略 bot 自己的訊息
	if (username === bot.username) {
		return false;
	}

	// 嘗試解析註冊指令
	const registerData = parseTeleportRegisterCommand(message);
	if (registerData) {
		const { x, y, z, name } = registerData;
		registerTeleportDestination(bot, x, y, z, name, username);
		return true;
	}

	// 嘗試解析傳送指令
	const destinationName = parseTeleportCommand(message);
	if (destinationName) {
		teleportToDestination(bot, destinationName, username);
		return true;
	}

	return false;
}

// ============== 傳送點系統結束 ==============

/**
 * 程式進入點
 */
function main() {
	log('info', '='.repeat(60));
	log('info', '🤖 AIK Minecraft Bot 啟動中...');
	log('info', '='.repeat(60));
	log('info', '📋 系統資訊:');
	log('info', `   Node.js 版本: ${process.version}`);
	log('info', `   運行平台: ${process.platform}`);
	log('info', `   工作目錄: ${process.cwd()}`);
	log('info', '='.repeat(60));

	// 驗證配置
	validateConfig();

	log('info', '');
	log('info', '🚀 準備啟動 Minecraft Bot...');
	log('info', '');

	// 建立並啟動 bot
	createBot();

	// 優雅的程式結束處理
	process.on('SIGINT', () => {
		log('info', '');
		log('info', '👋 收到中斷信號，正在關閉 Bot...');
		log('info', '✅ Bot 已安全關閉，感謝使用！');
		process.exit(0);
	});

	process.on('SIGTERM', () => {
		log('info', '');
		log('info', '👋 收到終止信號，正在關閉 Bot...');
		log('info', '✅ Bot 已安全關閉，感謝使用！');
		process.exit(0);
	});
}

// 啟動程式
main();
