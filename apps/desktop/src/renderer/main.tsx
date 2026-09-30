import { createRoot } from "react-dom/client";
import { Shell } from "./shell.js";
import "./styles/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(<Shell />);
