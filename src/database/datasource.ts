import { DataSource } from "typeorm";
import { Token } from "~/database/models/token";
import { Schedule } from "~/database/models/schedule";

export const AppDataSource =
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
        entities: [Token, Schedule],
      })
    : null;
