import { readFileSync } from "fs";
import { checkServerIdentity, type PeerCertificate } from "tls";
import { DataSource } from "typeorm";
import { RefreshToken } from "~/server/database/models/refreshToken";
import { Schedule } from "~/server/database/models/schedule";
import { TouBackup } from "~/server/database/models/touBackup";
import { SiteEvent } from "~/server/database/models/siteEvent";
import { User } from "~/server/database/models/user";
import { SignupVerification } from "~/server/database/models/signupVerification";
import { TouScheduleConfig } from "~/server/database/models/touScheduleConfig";
import { SiteCalibration } from "~/server/database/models/siteCalibration";
import { SiteCalibrationSample } from "~/server/database/models/siteCalibrationSample";
import { SiteSettings } from "~/server/database/models/siteSettings";
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
    const dbLog = logger.child({ service: "db" });
    const log = silent ? dbLog.trace.bind(dbLog) : dbLog.info.bind(dbLog);
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
              ? ({
                  rejectUnauthorized: true,
                  ca: readFileSync(process.env.DB_SSL_CA_PATH!).toString(),
                  // pg doesn't pass a valid SNI servername when host is an IP address,
                  // causing Node.js TLS to fall back to 'localhost' for checkServerIdentity.
                  // Override to verify against the actual DB host.
                  checkServerIdentity: (_host: string, cert: PeerCertificate) =>
                    checkServerIdentity(process.env.DB_HOST!, cert),
                } as any)
              : false,
            entities: [
              RefreshToken,
              Schedule,
              TouBackup,
              TouScheduleConfig,
              SiteEvent,
              User,
              SignupVerification,
              SiteCalibration,
              SiteCalibrationSample,
              SiteSettings,
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
        dbLog.error({ err: error }, "Database initialization failed");
        process.exit(1);
      });
    return AppDataSource.initializing;
  }
}

export default AppDataSource;
