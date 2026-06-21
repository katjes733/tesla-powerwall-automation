import { readFileSync } from "fs";
import { DataSource } from "typeorm";
import { RefreshToken } from "~/server/database/models/refreshToken";
import { Schedule } from "~/server/database/models/schedule";
import { TouBackup } from "~/server/database/models/touBackup";
import { User } from "~/server/database/models/user";
import { SignupVerification } from "~/server/database/models/signupVerification";
import { migrateTokenEncryption } from "~/server/database/migrateTokenEncryption";

class AppDataSource {
  private static instance: DataSource | null = null;
  private static initializing: Promise<DataSource> | null = null;

  private constructor() {}

  public static async getInstance(silent = false): Promise<DataSource> {
    if (AppDataSource.instance && AppDataSource.instance.isInitialized) {
      return AppDataSource.instance;
    }
    if (AppDataSource.initializing) {
      return AppDataSource.initializing;
    }
    const log = silent ? logger.trace.bind(logger) : logger.info.bind(logger);
    const dbSsl = process.env.DB_SSL === "true";
    if (dbSsl && !process.env.DB_SSL_CA_PATH) {
      throw new Error("DB_SSL_CA_PATH must be set when DB_SSL=true");
    }
    const dataSource =
      process.env.DB_HOST &&
      process.env.DB_USERNAME &&
      process.env.DB_PASSWORD &&
      process.env.DB_NAME
        ? new DataSource({
            type: "postgres",
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT || "5432", 10),
            username: process.env.DB_USERNAME,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            schema: process.env.DB_SCHEMA || "public",
            synchronize: false,
            ssl: dbSsl
              ? {
                  rejectUnauthorized: true,
                  ca: readFileSync(process.env.DB_SSL_CA_PATH!).toString(),
                }
              : false,
            entities: [
              RefreshToken,
              Schedule,
              TouBackup,
              User,
              SignupVerification,
            ],
          })
        : (() => {
            throw new Error(
              "Database connection parameters are not set in environment variables.",
            );
          })();
    AppDataSource.initializing = dataSource
      .initialize()
      .then(async () => {
        log("✅ Database connection established successfully.");
        const schema = process.env.DB_SCHEMA || "public";
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
          throw new Error(`Invalid DB_SCHEMA value: ${schema}`);
        }
        await dataSource.query(`CREATE SCHEMA IF NOT EXISTS "${schema}";`);
        log("✅ Database schema ensured successfully.");
        await dataSource.synchronize();
        log("✅ Database schema synchronised successfully.");
        await migrateTokenEncryption(dataSource);
        log("✅ Token encryption migration completed.");
        AppDataSource.instance = dataSource;
        AppDataSource.initializing = null;
        return dataSource;
      })
      .catch((error) => {
        logger.error(error, "❌ Error during Data Source initialization:");
        process.exit(1);
      });
    return AppDataSource.initializing;
  }
}

export default AppDataSource;
