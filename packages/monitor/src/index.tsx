import "./css/index.css";

import * as React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById('app')!).render(<App />);