import dotenv from "dotenv";
import createSimpleServer from "./simpleServer.js";
import colors from "colors";

dotenv.config();

const host = process.env.HOST || "127.0.0.1";
const port = process.env.PORT || 8080;
const web_server_url = process.env.PUBLIC_URL || `http://${host}:${port}`;

export default function server() {
  try {
    createSimpleServer();
  } catch (err) {
    console.error(colors.red("Failed to start server:"), err.message);
    process.exit(1);
  }
}
