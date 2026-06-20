import type { DataSource } from "typeorm";
import { encrypt, isEncrypted } from "~/server/util/tokenCrypto";

export async function migrateTokenEncryption(
  dataSource: DataSource,
): Promise<void> {
  const tokenRepo = dataSource.getRepository("RefreshToken");
  const tokens = (await tokenRepo.find({
    select: ["id", "refresh_token"],
  })) as unknown as Array<{ id: string; refresh_token: string }>;

  let tokenCount = 0;
  for (const token of tokens) {
    if (!isEncrypted(token.refresh_token)) {
      await tokenRepo.update(token.id, {
        refresh_token: encrypt(token.refresh_token),
      });
      tokenCount++;
    }
  }
  if (tokenCount > 0) {
    logger.info(`✅ Encrypted ${tokenCount} token(s) in refresh_tokens`);
  }

  const userRepo = dataSource.getRepository("User");
  const users = (await userRepo.find({
    select: ["id", "refresh_token"],
  })) as unknown as Array<{ id: string; refresh_token: string | null }>;

  let userCount = 0;
  for (const user of users) {
    if (user.refresh_token && !isEncrypted(user.refresh_token)) {
      await userRepo.update(user.id, {
        refresh_token: encrypt(user.refresh_token),
      });
      userCount++;
    }
  }
  if (userCount > 0) {
    logger.info(`✅ Encrypted ${userCount} token(s) in users`);
  }
}
