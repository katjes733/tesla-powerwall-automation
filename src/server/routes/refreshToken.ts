import { v4 } from "uuid";
import AppDataSource from "~/server/database/datasource";
import type { RefreshTokenData } from "~/server/types/common";

export async function upsert({
  id,
  email,
  refreshToken,
  expiresAt,
}: {
  id?: string;
  email: string;
  refreshToken: string;
  expiresAt?: Date;
}) {
  const tokenRepo = (await AppDataSource.getInstance()).getRepository(
    "RefreshToken",
  );
  let recordId = id || (await getByEmail(email).then((record) => record?.id));
  const newDate = new Date();
  const expiresAtDate =
    expiresAt ||
    new Date(newDate.getTime() + 24 * 60 * 60 * 1000 - 1 * 60 * 1000); // 24 hours minus 1 minute
  let status;
  if (!recordId) {
    recordId = v4();
    await tokenRepo.insert({
      id: recordId,
      creation_time: newDate,
      modified_time: newDate,
      email,
      refresh_token: refreshToken,
      expires_at: expiresAtDate,
    });
    status = 200;
  } else {
    await tokenRepo.update(recordId, {
      modified_time: newDate,
      refresh_token: refreshToken,
      expires_at: expiresAtDate,
    });
    status = 201;
  }
  return {
    status,
    action: status === 200 ? "created" : "updated",
    data: {
      id: recordId,
      email,
      refreshToken,
      expiresAt: expiresAtDate,
    } as RefreshTokenData,
  };
}

export async function getByEmail(email: string) {
  const tokenRepo = (await AppDataSource.getInstance()).getRepository(
    "RefreshToken",
  );
  return await tokenRepo
    .findOne({
      where: { email },
      select: ["id", "email", "refresh_token", "expires_at"],
    })
    .then((record) => {
      if (record) {
        return {
          id: record.id,
          email: record.email,
          refreshToken: record.refresh_token,
          expiresAt: record.expires_at,
        } as RefreshTokenData;
      }
      return null;
    });
}

export async function getAllEmails(): Promise<string[]> {
  const tokenRepo = (await AppDataSource.getInstance()).getRepository(
    "RefreshToken",
  );
  return tokenRepo
    .find({
      select: ["email"],
    })
    .then((records) => {
      return records.map((record) => record.email);
    });
}
