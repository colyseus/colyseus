// import method to setup local/development environment
import { listen } from "../src";

// import arena configuration file
import app from "./colyseus.config";

listen(app);
