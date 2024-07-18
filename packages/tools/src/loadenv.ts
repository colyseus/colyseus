import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

function getNodeEnv() {
  return process.env.NODE_ENV || "development";
}

function getRegion() {
  // EU, NA, AS, AF, AU, SA, UNKNOWN
  return (process.env.REGION || "unknown").toLowerCase();
}

function loadEnvFile(envFileOptions: string[], log: 'none' | 'success' | 'both'  = 'none') {
    const envPaths = [];
    envFileOptions.forEach((envFilename) => {
      envPaths.push(path.resolve(path.dirname(require?.main?.filename || process.cwd()), "..", envFilename));
      envPaths.push(path.resolve(process.cwd(), envFilename));
    });

    // return the first .env path found
    const envPath = envPaths.find((envPath) => fs.existsSync(envPath));

    if (envPath) {
        dotenv.config({ path: envPath });

        if (log !== "none") {
            console.info(`✅ ${path.basename(envPath)} loaded.`);
        }

    } else if (log === "both") {
        console.info(`ℹ️  optional .env file not found: ${envFileOptions.join(", ")}`);
    }
}

// load .env.cloud defined on admin panel
if (process.env.COLYSEUS_CLOUD !== undefined) {
    loadEnvFile([`.env.cloud`]);
}

// (overrides previous env configs)
loadEnvFile([`.env.${getNodeEnv()}`, `.env`], 'both');

if (process.env.REGION !== undefined) {
  loadEnvFile([`.env.${getRegion()}.${getNodeEnv()}`], 'success');
}