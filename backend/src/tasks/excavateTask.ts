import { Bot } from 'mineflayer';
import pkg from 'mineflayer-pathfinder';
const { goals } = pkg;
import { Vec3 } from 'vec3';
import { ExcavateRegion } from '../types.js';

export const MAX_EXCAVATE_BLOCKS = 10_000;

export interface ExcavateCallbacks {
	onEvent: (type: 'info' | 'warning' | 'error', message: string) => void;
	onProgress: (current: number, total: number) => void;
	onComplete: () => void;
	onAbort: () => void;
}

/**
 * Manages a single rectangular-area excavation task.
 *
 * Call run() to start; call abort() from any other context to cancel mid-task.
 * The task is completely stateless after run() resolves — create a new instance
 * for each excavation job.
 */
export class ExcavateTask {
	private abortFlag = false;

	abort(): void {
		this.abortFlag = true;
	}

	async run(
		bot: Bot,
		region: ExcavateRegion,
		callbacks: ExcavateCallbacks,
	): Promise<void> {
		const { onEvent, onProgress, onComplete, onAbort } = callbacks;

		// Normalise so min <= max on every axis.
		const minX = Math.min(region.x1, region.x2);
		const maxX = Math.max(region.x1, region.x2);
		const minY = Math.min(region.y1, region.y2);
		const maxY = Math.max(region.y1, region.y2);
		const minZ = Math.min(region.z1, region.z2);
		const maxZ = Math.max(region.z1, region.z2);

		const totalBlocks =
			(maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);

		if (totalBlocks > MAX_EXCAVATE_BLOCKS) {
			onEvent(
				'error',
				`Excavation region too large: ${totalBlocks} blocks (max ${MAX_EXCAVATE_BLOCKS}). Task cancelled.`,
			);
			onAbort();
			return;
		}

		onEvent(
			'info',
			`Starting excavation of ${totalBlocks} blocks ` +
				`(${minX},${minY},${minZ}) → (${maxX},${maxY},${maxZ}).`,
		);

		// Build the ordered dig list: top-down Y, zigzag XZ within each layer.
		const positions = buildDigOrder(minX, maxX, minY, maxY, minZ, maxZ);

		let digCount = 0;

		for (const pos of positions) {
			if (this.abortFlag) {
				onEvent('info', 'Excavation aborted by stop command.');
				onAbort();
				return;
			}

			const block = bot.blockAt(pos);

			// Skip air, null, or bedrock/barrier-class non-diggable blocks.
			if (!block || block.name === 'air' || !block.diggable) {
				digCount++;
				onProgress(digCount, positions.length);
				continue;
			}

			// Navigate to within 3 blocks of the target.
			try {
				await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 3));
			} catch {
				// Pathfinder may fail (unreachable, obstacle). Skip this block and continue.
				onEvent(
					'warning',
					`Cannot reach block at (${pos.x},${pos.y},${pos.z}) — skipping.`,
				);
				digCount++;
				onProgress(digCount, positions.length);
				continue;
			}

			if (this.abortFlag) {
				onEvent('info', 'Excavation aborted by stop command.');
				onAbort();
				return;
			}

			// Re-fetch the block after navigation (another player may have removed it).
			const freshBlock = bot.blockAt(pos);
			if (!freshBlock || freshBlock.name === 'air' || !freshBlock.diggable) {
				digCount++;
				onProgress(digCount, positions.length);
				continue;
			}

			// Equip the optimal mining tool for this block type.
			try {
				await bot.tool.equipForBlock(freshBlock, { requireHarvest: false });
			} catch {
				// No tool available — bot will dig with bare hands. Non-fatal.
				onEvent(
					'warning',
					`No optimal tool for ${freshBlock.name}; digging bare-handed.`,
				);
			}

			// Dig only if within reach (canDigBlock checks ≤5.1 blocks from eye).
			if (!bot.canDigBlock(freshBlock)) {
				onEvent(
					'warning',
					`Block (${pos.x},${pos.y},${pos.z}) still out of reach after navigation — skipping.`,
				);
				digCount++;
				onProgress(digCount, positions.length);
				continue;
			}

			try {
				// forceLook=true: bot turns to face the block before digging.
				await bot.dig(freshBlock, true);
			} catch (err) {
				onEvent(
					'warning',
					`Failed to dig block at (${pos.x},${pos.y},${pos.z}): ${(err as Error).message}`,
				);
			}

			digCount++;
			onProgress(digCount, positions.length);
		}

		if (!this.abortFlag) {
			onComplete();
		}
	}
}

/**
 * Generates the list of positions to dig in optimal order:
 *   - Y layers from top (maxY) down to bottom (minY) — prevents the bot from
 *     being buried by blocks falling from above.
 *   - Within each Y layer, rows are iterated in a snake/zigzag pattern along X
 *     to minimise travel distance.
 */
function buildDigOrder(
	minX: number,
	maxX: number,
	minY: number,
	maxY: number,
	minZ: number,
	maxZ: number,
): Vec3[] {
	const positions: Vec3[] = [];

	for (let y = maxY; y >= minY; y--) {
		for (let x = minX; x <= maxX; x++) {
			// Even X-offset rows go Z low→high; odd rows go Z high→low.
			const xOffset = x - minX;
			if (xOffset % 2 === 0) {
				for (let z = minZ; z <= maxZ; z++) {
					positions.push(new Vec3(x, y, z));
				}
			} else {
				for (let z = maxZ; z >= minZ; z--) {
					positions.push(new Vec3(x, y, z));
				}
			}
		}
	}

	return positions;
}
