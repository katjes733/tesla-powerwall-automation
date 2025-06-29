import { DataSource } from "typeorm";
import { RefreshToken } from "~/server/database/models/refreshToken";
import { Schedule } from "~/server/database/models/schedule";

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
            // ssl: {
            //   rejectUnauthorized: false,
            // },
            entities: [RefreshToken, Schedule],
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
        await dataSource.query(
          `CREATE SCHEMA IF NOT EXISTS "${process.env.DB_SCHEMA || "public"}";`,
        );
        log("✅ Database schema ensured successfully.");
        await dataSource.synchronize();
        log("✅ Database migrations completed successfully.");
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
