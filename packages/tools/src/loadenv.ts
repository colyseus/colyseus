import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

function getEnvFromArgv() {
  const envIndex = process.argv.indexOf("--env");
  return (envIndex !== -1) ? process.argv[envIndex + 1] : undefined;
}

function getNodeEnv() {
  return process.env.NODE_ENV || getEnvFromArgv() || "development";
}

function getRegion() {
  // EU, NA, AS, AF, AU, SA, UNKNOWN
  return (process.env.REGION || "unknown").toLowerCase();
}

function loadEnvFile(envFileOptions: string[], log: 'none' | 'success' | 'both'  = 'none', override: boolean = false) {
    const envPaths = [];
    envFileOptions.forEach((envFilename) => {
      if (envFilename.startsWith("/")) {
        envPaths.push(envFilename);
      } else {
        envPaths.push(path.resolve(path.dirname(typeof(require) !== "undefined" && require?.main?.filename || process.cwd()), "..", envFilename));
        envPaths.push(path.resolve(process.cwd(), envFilename));
      }
    });

    // return the first .env path found
    const envPath = envPaths.find((envPath) => fs.existsSync(envPath));

    if (envPath) {
        dotenv.config({ path: envPath, override });

        if (log !== "none") {
            console.info(`✅ ${path.basename(envPath)} loaded.`);
        }

    } else if (log === "both") {
        console.info(`ℹ️  optional .env file not found: ${envFileOptions.join(", ")}`);
    }
}

// reload /etc/environment, if exists
if (fs.existsSync("/etc/environment")) {
  dotenv.config({ path: "/etc/environment", override: true })
}

// (overrides previous env configs)
loadEnvFile([`.env.${getNodeEnv()}`, `.env`], 'both');

// load .env.cloud defined on admin panel
if (process.env.COLYSEUS_CLOUD !== undefined) {
    const cloudEnvFileNames = [".env.cloud"];

    // prepend .env.cloud file from APP_ROOT_PATH
    if (process.env.APP_ROOT_PATH) {
      cloudEnvFileNames.unshift(`${process.env.APP_ROOT_PATH}${(process.env.APP_ROOT_PATH.endsWith("/") ? "" : "/")}.env.cloud`);
    }

    // .env.cloud can override previously loaded environment variables
    loadEnvFile(cloudEnvFileNames, 'none', true);
}

if (process.env.REGION !== undefined) {
  loadEnvFile([`.env.${getRegion()}.${getNodeEnv()}`], 'success');
}
