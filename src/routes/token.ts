import { v4 } from "uuid";
import AppDataSource from "~/database/datasource";

export async function upsert({
  id,
  email,
  token,
  expiresAt,
}: {
  id?: string;
  email: string;
  token: string;
  expiresAt?: Date;
}) {
  const tokenRepo = (await AppDataSource.getInstance()).getRepository("Token");
  let recordId =
    id ||
    (await tokenRepo
      .findOne({
        where: { email },
        select: ["id"],
      })
      .then((record) => record?.id));
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
      token,
      expires_at: expiresAtDate,
    });
    status = 200;
  } else {
    await tokenRepo.update(recordId, {
      modified_time: newDate,
      token,
      expires_at: expiresAtDate,
    });
    status = 201;
  }
  return {
    status,
    action: status === 200 ? "created" : "updated",
    id: recordId,
    email,
    token,
    expiresAt: expiresAtDate,
  };
}
