// import method to setup local/development environment
import { listen } from "../src/index.ts";

// import arena configuration file
import app from "./colyseus.config.ts";

listen(app);
