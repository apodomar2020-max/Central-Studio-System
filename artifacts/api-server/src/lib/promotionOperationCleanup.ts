import { cleanupPromotionOperations } from "./promotionOperations";
import { logger } from "./logger";

/** Small API-local maintenance loop. Correctness is in PostgreSQL; replicas
 * safely skip locked rows. No Redis dependency and no automatic save execution. */
export function startPromotionOperationCleanup() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await cleanupPromotionOperations(1000);
    } catch {
      logger.error(
        "Promotion operation retention cleanup failed; will retry next minute",
      );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    void run();
  }, 60_000);
  timer.unref();
  void run();
  return () => clearInterval(timer);
}
